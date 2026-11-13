import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { asDbDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool } from '../branches/branches.service.js';
import { subjectNameKey } from './subjectInput.js';

/*
 * Subjects and class curricula (docs/business-rules.md → Subjects). School level: the School Owner
 * creates, edits, deactivates and reactivates subjects and sets which subjects each class studies;
 * the school's Managers read them. `school` is decided by the server from the account.
 *
 * Writes share the school's class lock (`classes:<schoolId>`, as classes and sections), with the
 * school ACTIVE (409 SCHOOL_SUSPENDED). Each change and its audit event are written together;
 * unchanged submissions record nothing. Subjects are never deleted.
 */

const TX = { timeout: 20000, maxWait: 10000 };
const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const mentions = (error, text) => {
  try {
    return `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`.includes(text);
  } catch {
    return false;
  }
};

const NAME_TAKEN = () =>
  conflict('NAME_TAKEN', 'A subject with this name already exists in your school.', { name: 'Already used in your school (compared without regard to capitalization).' });
const CODE_TAKEN = () => conflict('CODE_TAKEN', 'Another subject of your school already uses this code.', { code: 'Already used by another subject.' });

function translateDbError(error) {
  if (isUniqueViolation(error) && mentions(error, 'code')) return CODE_TAKEN();
  if (isUniqueViolation(error) && mentions(error, 'nameKey')) return NAME_TAKEN();
  return error;
}

async function withSchoolLock(school, work) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`classes:${school.id}`}))`;
      await lockActiveSchool(tx, school);
      return work(tx);
    }, TX);
  } catch (error) {
    throw translateDbError(error);
  }
}

/** Teaching assignments still running or to come (from `today`) in planned or current years. */
const liveAssignments = (today) => ({
  cancelledAt: null,
  OR: [{ endDate: null }, { endDate: { gte: asDbDay(today) } }],
  academicYear: { status: { in: ['PLANNED', 'CURRENT'] } },
});

export const toSubject = (s, extra = {}) => ({
  id: s.id,
  name: s.name,
  code: s.code ?? '',
  description: s.description ?? '',
  status: fromDbStatus(s.status),
  deactivatedAt: s.deactivatedAt?.toISOString() ?? null,
  createdAt: s.createdAt.toISOString(),
  ...extra,
});

async function findOrFail(client, school, id) {
  const subject = isUuid(id) ? await client.subject.findFirst({ where: { id, schoolId: school.id } }) : null;
  if (!subject) throw notFound('Subject not found.');
  return subject;
}

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const audit = (tx, action, school, subject, { user, req, description, fields }) =>
  recordAuditEvent({ client: tx, action, actor: actorOf(user), target: { type: 'subject', id: subject.id, name: subject.name }, schoolId: school.id, description, change: { fields }, req });

// ---- reads (School Owner and Manager) ---------------------------------------------------------

/** The school's subjects by name, with how many classes study each and their live teaching assignments. */
export async function listSubjects(school, { q, status }) {
  const today = await calendarToday();
  const rows = await getPrisma().subject.findMany({
    where: {
      schoolId: school.id,
      ...(status && { status: status.toUpperCase() }),
      ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }),
    },
    orderBy: [{ name: 'asc' }],
    include: { _count: { select: { classes: true, teachingAssignments: { where: liveAssignments(today) } } } },
  });
  return { items: rows.map((s) => toSubject(s, { classes: s._count.classes, assignments: s._count.teachingAssignments })) };
}

export async function getSubject(school, id) {
  const prisma = getPrisma();
  const subject = await findOrFail(prisma, school, id);
  const classes = await prisma.classSubject.findMany({
    where: { subjectId: subject.id },
    include: { class: { select: { id: true, name: true, sequence: true, status: true } } },
    orderBy: { class: { sequence: 'asc' } },
  });
  return toSubject(subject, {
    classes: classes.map((c) => ({ id: c.class.id, name: c.class.name, sequence: c.class.sequence, status: fromDbStatus(c.class.status), weeklyLessons: c.weeklyLessons })),
  });
}

// ---- changes (School Owner) -------------------------------------------------------------------

const LABELS = { name: 'Name', code: 'Code', description: 'Description' };

export async function createSubject(school, values, user, req) {
  const created = await withSchoolLock(school, async (tx) => {
    const subject = await tx.subject.create({ data: { schoolId: school.id, ...values, nameKey: subjectNameKey(values.name) } });
    await audit(tx, AUDIT_ACTIONS.SUBJECT_CREATED, school, subject, {
      user,
      req,
      description: `Subject ${subject.name} created.`,
      fields: Object.keys(LABELS).filter((f) => subject[f]).map((f) => ({ field: LABELS[f], from: null, to: subject[f] })),
    });
    return subject;
  });
  return toSubject(created);
}

export async function updateSubject(school, id, values, user, req) {
  const updated = await withSchoolLock(school, async (tx) => {
    const current = await findOrFail(tx, school, id);
    const changed = Object.keys(values).filter((f) => (values[f] ?? null) !== (current[f] ?? null));
    if (!changed.length) return current;
    const data = Object.fromEntries(changed.map((f) => [f, values[f]]));
    if (data.name) data.nameKey = subjectNameKey(data.name);
    const saved = await tx.subject.update({ where: { id: current.id }, data });
    await audit(tx, AUDIT_ACTIONS.SUBJECT_UPDATED, school, saved, {
      user,
      req,
      description: `Subject ${saved.name} updated: ${changed.map((f) => LABELS[f]).join(', ')}.`,
      fields: changed.map((f) => ({ field: LABELS[f], from: current[f] ?? null, to: saved[f] ?? null })),
    });
    return saved;
  });
  return toSubject(updated);
}

/**
 * Deactivates a subject: no new teaching assignments or curriculum entries. Refused while it is
 * taught (live assignments in a planned or current year: 409 SUBJECT_IN_USE). Curricula keep it.
 */
export async function deactivateSubject(school, id, user, req) {
  const today = await calendarToday();
  const result = await withSchoolLock(school, async (tx) => {
    const subject = await findOrFail(tx, school, id);
    if (subject.status === 'INACTIVE') return subject;
    const taught = await tx.teachingAssignment.count({ where: { subjectId: subject.id, ...liveAssignments(today) } });
    if (taught) {
      throw conflict('SUBJECT_IN_USE', `${subject.name} has ${taught} teaching assignment${taught === 1 ? '' : 's'} running or to come. End them before deactivating it.`, { assignments: taught });
    }
    const saved = await tx.subject.update({ where: { id: subject.id }, data: { status: 'INACTIVE', deactivatedAt: new Date() } });
    await audit(tx, AUDIT_ACTIONS.SUBJECT_DEACTIVATED, school, saved, { user, req, description: `Subject ${saved.name} deactivated.`, fields: [{ field: 'Status', from: 'Active', to: 'Inactive' }] });
    return saved;
  });
  return toSubject(result);
}

export async function reactivateSubject(school, id, user, req) {
  const result = await withSchoolLock(school, async (tx) => {
    const subject = await findOrFail(tx, school, id);
    if (subject.status === 'ACTIVE') return subject;
    const saved = await tx.subject.update({ where: { id: subject.id }, data: { status: 'ACTIVE', deactivatedAt: null } });
    await audit(tx, AUDIT_ACTIONS.SUBJECT_REACTIVATED, school, saved, { user, req, description: `Subject ${saved.name} reactivated.`, fields: [{ field: 'Status', from: 'Inactive', to: 'Active' }] });
    return saved;
  });
  return toSubject(result);
}

// ---- class curricula --------------------------------------------------------------------------

async function findClass(client, school, id) {
  const cls = isUuid(id) ? await client.schoolClass.findFirst({ where: { id, schoolId: school.id } }) : null;
  if (!cls) throw notFound('Class not found.');
  return cls;
}

const toCurriculumItem = (c) => ({ subject: toSubject(c.subject), weeklyLessons: c.weeklyLessons });

/** A class's subjects (by subject name) and their total lessons per week. `open`: no list set, every active subject may be taught. */
export async function getCurriculum(school, classId, client = getPrisma()) {
  const cls = await findClass(client, school, classId);
  const rows = await client.classSubject.findMany({ where: { classId: cls.id }, include: { subject: true }, orderBy: { subject: { name: 'asc' } } });
  return {
    class: { id: cls.id, name: cls.name, sequence: cls.sequence, status: fromDbStatus(cls.status) },
    open: rows.length === 0,
    weeklyLessons: rows.reduce((sum, r) => sum + (r.weeklyLessons ?? 0), 0),
    items: rows.map(toCurriculumItem),
  };
}

/**
 * Replaces a class's curriculum (School Owner). New subjects must be active subjects of the school;
 * a subject still taught in the class's sections (live assignments) cannot be removed (409 SUBJECT_IN_USE).
 */
export async function setCurriculum(school, classId, items, user, req) {
  const today = await calendarToday();
  await withSchoolLock(school, async (tx) => {
    const cls = await findClass(tx, school, classId);
    const current = await tx.classSubject.findMany({ where: { classId: cls.id }, include: { subject: true } });
    const byId = new Map(current.map((c) => [c.subjectId, c]));
    const wanted = new Map(items.map((i) => [i.subjectId, i]));

    const added = items.filter((i) => !byId.has(i.subjectId));
    const subjects = added.length ? await tx.subject.findMany({ where: { id: { in: added.map((i) => i.subjectId) }, schoolId: school.id } }) : [];
    const known = new Map(subjects.map((s) => [s.id, s]));
    const details = {};
    items.forEach((item, index) => {
      if (byId.has(item.subjectId)) return;
      const subject = known.get(item.subjectId);
      if (!subject) details[`subjects.${index}.subject`] = 'Subject not found in your school.';
      else if (subject.status !== 'ACTIVE') details[`subjects.${index}.subject`] = `${subject.name} is inactive. Reactivate it first.`;
    });
    if (Object.keys(details).length) throw conflict('SUBJECT_UNAVAILABLE', 'Some subjects cannot be added.', details);

    const removed = current.filter((c) => !wanted.has(c.subjectId));
    if (removed.length) {
      const taught = await tx.teachingAssignment.findMany({
        where: { subjectId: { in: removed.map((r) => r.subjectId) }, section: { classId: cls.id }, ...liveAssignments(today) },
        select: { subjectId: true },
        distinct: ['subjectId'],
      });
      if (taught.length) {
        const names = taught.map((t) => byId.get(t.subjectId).subject.name);
        throw conflict('SUBJECT_IN_USE', `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} still taught in ${cls.name}. End those teaching assignments first.`, { subjects: names });
      }
    }
    const changedLessons = items.filter((i) => byId.has(i.subjectId) && (byId.get(i.subjectId).weeklyLessons ?? null) !== i.weeklyLessons);
    if (!added.length && !removed.length && !changedLessons.length) return;

    if (removed.length) await tx.classSubject.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
    for (const item of changedLessons) await tx.classSubject.update({ where: { id: byId.get(item.subjectId).id }, data: { weeklyLessons: item.weeklyLessons } });
    if (added.length) await tx.classSubject.createMany({ data: added.map((i) => ({ schoolId: school.id, classId: cls.id, subjectId: i.subjectId, weeklyLessons: i.weeklyLessons })) });

    const label = (subjectId, lessons) => `${known.get(subjectId)?.name ?? byId.get(subjectId)?.subject.name}${lessons ? ` (${lessons}/week)` : ''}`;
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.CLASS_SUBJECTS_UPDATED,
      actor: actorOf(user),
      target: { type: 'class', id: cls.id, name: cls.name },
      schoolId: school.id,
      description: `Subjects of ${cls.name} updated.`,
      change: {
        fields: [
          ...added.map((i) => ({ field: 'Subject added', from: null, to: label(i.subjectId, i.weeklyLessons) })),
          ...removed.map((r) => ({ field: 'Subject removed', from: label(r.subjectId, r.weeklyLessons), to: null })),
          ...changedLessons.map((i) => ({ field: `Lessons per week: ${byId.get(i.subjectId).subject.name}`, from: byId.get(i.subjectId).weeklyLessons, to: i.weeklyLessons })),
        ],
      },
      req,
    });
  });
  return getCurriculum(school, classId);
}

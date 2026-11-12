import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { pageWindow } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { operatingState } from '../branches/branches.service.js';
import { resolveYear } from '../classes/classes.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { studentNameKey } from './studentInput.js';

/*
 * Students and their enrollments (approved rules: docs/business-rules.md → Students; Student
 * enrollment). A student is registered once, in one branch of a school, and keeps one permanent
 * profile; each academic year is a separate Enrollment in a section of that year and branch. Nothing
 * is deleted and old enrollments are never moved or overwritten.
 *
 * `scope` comes from the signed-in account, never from the request: { school, branch: null } for a
 * School Owner (the whole school) or { school, branch } for a Manager (their branch only). Every id in
 * a request is looked up inside that scope; anything else is not found (404).
 *
 * Writes run in one transaction with a per-branch advisory lock (one change at a time per branch,
 * which also serializes Student ID numbers) and need the school and branch ACTIVE (409
 * BRANCH_NOT_OPERATING). Each change and its audit event are written together.
 */

const day = (date) => date.toISOString().slice(0, 10);
const lower = (value) => value?.toLowerCase() ?? null;
const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Interactive transactions here wait for locks and run several queries: allow up to 20 s (Prisma's default is 5 s). */
export const TX = { timeout: 20000, maxWait: 10000 };
const transaction = (work) => getPrisma().$transaction(work, TX);

const ALREADY_ENROLLED = (year) => conflict('ALREADY_ENROLLED', `This student is already enrolled in ${year?.name ?? 'this academic year'}. A student has one enrollment per academic year.`);

// ---- locking ------------------------------------------------------------------------------------

/** Locks the branch's student records and requires the school and branch to be ACTIVE. */
export async function lockBranchForStudents(tx, scope, branchId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`students:${branchId}`}))`;
  const [school] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "School" WHERE "id" = ${scope.school.id} FOR SHARE`;
  const [branch] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "Branch" WHERE "id" = ${branchId} AND "schoolId" = ${scope.school.id} FOR SHARE`;
  if (!branch) throw notFound('Branch not found.');
  const { operating, reasons } = operatingState(branch, school ?? { status: 'SUSPENDED' });
  if (!operating) {
    const whose = reasons.includes('school_suspended') ? 'The school is suspended' : 'The branch is suspended';
    throw conflict('BRANCH_NOT_OPERATING', `${whose}. Its students can be viewed but not changed until it is reactivated.`, { reasons });
  }
}

// ---- shapes ---------------------------------------------------------------------------------------

const enrollmentInclude = {
  section: { include: { class: { select: { id: true, name: true, sequence: true } } } },
  academicYear: true,
  branch: { select: { id: true, name: true, code: true } },
};

export const fullName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

/** An enrollment as the web app shows it ("Grade 7A"). */
export const toEnrollment = (e) => ({
  id: e.id,
  status: lower(e.status),
  entry: lower(e.entry),
  result: lower(e.result),
  enrolledAt: e.enrolledAt.toISOString(),
  endedAt: e.endedAt?.toISOString() ?? null,
  academicYear: { id: e.academicYear.id, name: e.academicYear.name, status: lower(e.academicYear.status), startDate: day(e.academicYear.startDate) },
  class: { id: e.section.class.id, name: e.section.class.name, sequence: e.section.class.sequence },
  section: { id: e.section.id, name: e.section.name, displayName: sectionDisplayName(e.section.class.name, e.section.name) },
  branch: e.branch,
  previousEnrollmentId: e.previousEnrollmentId ?? null,
});

export const toStudent = (s, extra = {}) => ({
  id: s.id,
  studentNumber: s.studentNumber,
  firstName: s.firstName,
  middleName: s.middleName ?? '',
  lastName: s.lastName,
  fullName: fullName(s),
  gender: lower(s.gender),
  dateOfBirth: day(s.dateOfBirth),
  phone: s.phone ?? '',
  address: s.address ?? '',
  guardianName: s.guardianName,
  guardianPhone: s.guardianPhone,
  guardianRelationship: s.guardianRelationship ?? '',
  emergencyContactName: s.emergencyContactName ?? '',
  emergencyContactPhone: s.emergencyContactPhone ?? '',
  status: lower(s.status),
  statusReason: s.statusReason ?? null,
  statusChangedAt: s.statusChangedAt?.toISOString() ?? null,
  registeredAt: s.registeredAt.toISOString(),
  branch: s.branch ? { id: s.branch.id, name: s.branch.name, code: s.branch.code } : undefined,
  ...extra,
});

// ---- lookups --------------------------------------------------------------------------------------

const studentWhere = (scope, id) => ({ id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) });

async function findStudent(client, scope, id) {
  const student = isUuid(id) ? await client.student.findFirst({ where: studentWhere(scope, id), include: { branch: { select: { id: true, name: true, code: true } } } }) : null;
  // A student of another school, or (Manager) of another branch, is reported like one that does not exist.
  if (!student) throw notFound('Student not found.');
  return student;
}

async function findEnrollment(client, scope, id) {
  const where = { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) };
  const enrollment = isUuid(id) ? await client.enrollment.findFirst({ where, include: { ...enrollmentInclude, student: true } }) : null;
  if (!enrollment) throw notFound('Enrollment not found.');
  return enrollment;
}

/** A section a student can be placed in: of the branch, active, of an active class, in a planned or current year. */
async function findPlaceableSection(client, scope, branchId, id) {
  const section = isUuid(id)
    ? await client.section.findFirst({ where: { id, schoolId: scope.school.id, branchId }, include: { class: true, academicYear: true } })
    : null;
  if (!section) throw notFound('Section not found in this branch.');
  if (section.status !== 'ACTIVE') throw conflict('SECTION_INACTIVE', `${sectionDisplayName(section.class.name, section.name)} is inactive and cannot take students.`);
  if (section.class.status !== 'ACTIVE') throw conflict('CLASS_INACTIVE', `${section.class.name} is inactive.`);
  if (section.academicYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${section.academicYear.name} is closed. Students cannot be enrolled in it.`);
  return section;
}

// ---- audit ----------------------------------------------------------------------------------------

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const studentTarget = (s) => ({ type: 'student', id: s.id, name: `${fullName(s)} (${s.studentNumber})` });
const LABELS = {
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  gender: 'Gender',
  dateOfBirth: 'Date of birth',
  phone: 'Phone',
  address: 'Address',
  guardianName: 'Guardian name',
  guardianPhone: 'Guardian phone',
  guardianRelationship: 'Guardian relationship',
  emergencyContactName: 'Emergency contact name',
  emergencyContactPhone: 'Emergency contact phone',
};
const shown = (value) => (value instanceof Date ? day(value) : value === null || value === undefined || value === '' ? 'Not set' : String(value));
const same = (a, b) => (a instanceof Date || b instanceof Date ? a?.getTime?.() === b?.getTime?.() : (a ?? null) === (b ?? null));

function audit(tx, action, student, { scope, user, req, description, fields }) {
  return recordAuditEvent({ client: tx, action, actor: actorOf(user), target: studentTarget(student), schoolId: scope.school.id, description, change: { fields }, req });
}

// ---- reads ----------------------------------------------------------------------------------------

/**
 * The student directory: students in scope (an Owner may filter one branch), searched by name or
 * Student ID, with their enrollment in the academic year (default: current, else newest).
 */
export async function listStudents(scope, { q, academicYear, branch, classId, sectionId, status, enrollment, page, pageSize }) {
  const prisma = getPrisma();
  const year = await resolveYear(scope, academicYear, prisma);
  const words = q?.split(/\s+/).filter(Boolean) ?? [];
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const inYear = year
    ? { academicYearId: year.id, ...(classId && { section: { classId } }), ...(sectionId && { sectionId }) }
    : null;
  const where = {
    schoolId: scope.school.id,
    ...(scope.branch ? { branchId: scope.branch.id } : branch && { branchId: branch }),
    ...(status && { status: status.toUpperCase() }),
    // Every word must match a name part or the Student ID.
    ...(words.length && { AND: words.map((w) => ({ OR: [{ firstName: contains(w) }, { middleName: contains(w) }, { lastName: contains(w) }, { studentNumber: contains(w) }] })) }),
    ...((classId || sectionId || enrollment === 'enrolled') && inYear && { enrollments: { some: inYear } }),
    ...(enrollment === 'not_enrolled' && year && { enrollments: { none: { academicYearId: year.id } } }),
  };
  if ((classId || sectionId || enrollment === 'enrolled') && !year) return { academicYear: null, items: [], total: 0, page: 1, pageSize, pageCount: 0 };
  const total = await prisma.student.count({ where });
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.student.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true, code: true } },
      ...(year && { enrollments: { where: { academicYearId: year.id }, include: enrollmentInclude } }),
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { studentNumber: 'asc' }],
    skip,
    take,
  });
  return {
    academicYear: year && { id: year.id, name: year.name, status: lower(year.status) },
    items: rows.map((s) => toStudent(s, { enrollment: s.enrollments?.[0] ? toEnrollment(s.enrollments[0]) : null })),
    ...meta,
  };
}

/** One student with the full enrollment history (oldest year first) and each promotion decision. */
export async function getStudent(scope, id) {
  const prisma = getPrisma();
  const student = await findStudent(prisma, scope, id);
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.id },
    include: enrollmentInclude,
    orderBy: { academicYear: { startDate: 'asc' } },
  });
  const decisions = await prisma.promotionItem.findMany({
    where: { studentId: student.id, status: { in: ['DONE', 'EXCLUDED'] } },
    include: { batch: { include: { toYear: true } } },
  });
  return toStudent(student, {
    enrollments: enrollments.map((e) => {
      const decision = decisions.find((d) => d.fromEnrollmentId === e.id);
      return { ...toEnrollment(e), decision: decision ? { decision: lower(decision.decision), status: lower(decision.status), toYear: decision.batch.toYear.name, at: decision.processedAt?.toISOString() ?? null } : null };
    }),
  });
}

// ---- profile changes (School Owner: any branch of the school; Manager: own branch) -----------------

/**
 * Registers a student (PENDING_ENROLLMENT: no class or section is chosen here). The Student ID is
 * generated from the branch. A student with the same full name and date of birth already in the
 * school is reported (409 POSSIBLE_DUPLICATE, with their Student IDs) unless `confirmDuplicate`.
 */
export async function registerStudent(scope, { profile, branchId, confirmDuplicate }, user, req) {
  const branch = scope.branch?.id ?? branchId;
  const key = studentNameKey(profile);
  const created = await transaction(async (tx) => {
    await lockBranchForStudents(tx, scope, branch);
    if (!confirmDuplicate) {
      const twins = await tx.student.findMany({ where: { schoolId: scope.school.id, nameKey: key, dateOfBirth: profile.dateOfBirth }, select: { studentNumber: true }, take: 5 });
      if (twins.length) {
        throw conflict(
          'POSSIBLE_DUPLICATE',
          `A student with this name and date of birth is already registered (${twins.map((t) => t.studentNumber).join(', ')}). Check that this is a different student, then confirm to register anyway.`,
          { studentNumbers: twins.map((t) => t.studentNumber) },
        );
      }
    }
    const [row] = await tx.$queryRaw`UPDATE "Branch" SET "studentSequence" = "studentSequence" + 1 WHERE "id" = ${branch} RETURNING "studentSequence", "code"`;
    const studentNumber = `${row.code}-S${String(Number(row.studentSequence)).padStart(4, '0')}`;
    const student = await tx.student.create({
      data: { schoolId: scope.school.id, branchId: branch, studentNumber, ...profile, nameKey: key, status: 'PENDING_ENROLLMENT' },
      include: { branch: { select: { id: true, name: true, code: true } } },
    });
    await audit(tx, AUDIT_ACTIONS.STUDENT_REGISTERED, student, {
      scope,
      user,
      req,
      description: `Student registered with Student ID ${studentNumber} in ${student.branch.name} (${student.branch.code}); pending enrollment.`,
      fields: [{ field: 'Status', from: null, to: 'Pending enrollment' }, ...Object.keys(LABELS).map((f) => ({ field: LABELS[f], from: null, to: shown(student[f]) }))],
    });
    return student;
  });
  return toStudent(created);
}

/** Edits profile fields. Unchanged values are ignored; nothing changed → no event. */
export async function updateStudent(scope, id, values, user, req) {
  const prisma = getPrisma();
  const existing = await findStudent(prisma, scope, id);
  const result = await transaction(async (tx) => {
    await lockBranchForStudents(tx, scope, existing.branchId);
    const current = await findStudent(tx, scope, id);
    const changed = Object.keys(values).filter((f) => !same(current[f], values[f]));
    if (!changed.length) return current;
    const data = Object.fromEntries(changed.map((f) => [f, values[f]]));
    if (changed.some((f) => ['firstName', 'middleName', 'lastName'].includes(f))) data.nameKey = studentNameKey({ ...current, ...data });
    const updated = await tx.student.update({ where: { id: current.id }, data, include: { branch: { select: { id: true, name: true, code: true } } } });
    await audit(tx, AUDIT_ACTIONS.STUDENT_UPDATED, updated, {
      scope,
      user,
      req,
      description: `Student details updated: ${changed.map((f) => LABELS[f]).join(', ')}.`,
      fields: changed.map((f) => ({ field: LABELS[f], from: shown(current[f]), to: shown(updated[f]) })),
    });
    return updated;
  });
  return toStudent(result);
}

// ---- enrollment (Manager, own branch) ------------------------------------------------------------

/**
 * Enrolls a student in a section (its academic year, class and branch follow from the section). One
 * enrollment per student and year (409 ALREADY_ENROLLED; the database enforces it too). A graduated
 * student cannot be enrolled; a transferred-out student can (re-admission).
 */
export async function enrollStudent(scope, studentId, { sectionId }, user, req) {
  const prisma = getPrisma();
  try {
    const enrollment = await transaction(async (tx) => {
      await lockBranchForStudents(tx, scope, scope.branch.id);
      const student = await findStudent(tx, scope, studentId);
      if (student.status === 'GRADUATED') throw conflict('STUDENT_GRADUATED', `${fullName(student)} has graduated and cannot be enrolled again.`);
      const section = await findPlaceableSection(tx, scope, scope.branch.id, sectionId);
      const existing = await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: section.academicYearId } } });
      if (existing) throw ALREADY_ENROLLED(section.academicYear);
      const created = await tx.enrollment.create({
        data: { schoolId: scope.school.id, branchId: scope.branch.id, studentId: student.id, academicYearId: section.academicYearId, sectionId: section.id, entry: 'NEW' },
        include: enrollmentInclude,
      });
      if (student.status !== 'ENROLLED') {
        await tx.student.update({ where: { id: student.id }, data: { status: 'ENROLLED', statusReason: null, statusChangedAt: new Date() } });
      }
      const label = sectionDisplayName(section.class.name, section.name);
      await audit(tx, AUDIT_ACTIONS.STUDENT_ENROLLED, student, {
        scope,
        user,
        req,
        description: `Enrolled in ${label} for ${section.academicYear.name}.`,
        fields: [
          { field: 'Academic year', from: null, to: section.academicYear.name },
          { field: 'Section', from: null, to: label },
          ...(student.status !== 'ENROLLED' ? [{ field: 'Status', from: STATUS_LABELS[student.status], to: STATUS_LABELS.ENROLLED }] : []),
        ],
      });
      return created;
    });
    return toEnrollment(enrollment);
  } catch (error) {
    if (isUniqueViolation(error)) throw ALREADY_ENROLLED(null);
    throw error;
  }
}

const STATUS_LABELS = { PENDING_ENROLLMENT: 'Pending enrollment', ENROLLED: 'Enrolled', TRANSFERRED_OUT: 'Transferred out', GRADUATED: 'Graduated' };
const RESULT_LABELS = { PASSED: 'Passed', FAILED: 'Failed' };

/**
 * Changes an ACTIVE enrollment: its section (a correction within the same academic year and branch,
 * not in a closed year) and/or its year-end result (Passed / Failed / none), which promotion uses.
 */
export async function updateEnrollment(scope, id, values, user, req) {
  const result = await transaction(async (tx) => {
    await lockBranchForStudents(tx, scope, scope.branch.id);
    const current = await findEnrollment(tx, scope, id);
    if (current.status !== 'ACTIVE') throw conflict('ENROLLMENT_ENDED', 'This enrollment has ended and is kept as it is.');
    const fields = [];
    const data = {};
    if (values.sectionId !== undefined && values.sectionId !== current.sectionId) {
      if (current.academicYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${current.academicYear.name} is closed. Its enrollments are kept as they are.`);
      const section = await findPlaceableSection(tx, scope, scope.branch.id, values.sectionId);
      if (section.academicYearId !== current.academicYearId) {
        throw conflict('WRONG_YEAR', `Choose a section of ${current.academicYear.name}. A new academic year needs a new enrollment.`);
      }
      data.sectionId = section.id;
      fields.push({ field: 'Section', from: toEnrollment(current).section.displayName, to: sectionDisplayName(section.class.name, section.name) });
    }
    if (values.result !== undefined && values.result !== current.result) {
      data.result = values.result;
      fields.push({ field: 'Year-end result', from: RESULT_LABELS[current.result] ?? 'Not set', to: RESULT_LABELS[values.result] ?? 'Not set' });
    }
    if (!fields.length) return current;
    const updated = await tx.enrollment.update({ where: { id: current.id }, data, include: enrollmentInclude });
    await audit(tx, AUDIT_ACTIONS.ENROLLMENT_UPDATED, current.student, {
      scope,
      user,
      req,
      description: `Enrollment in ${current.academicYear.name} updated: ${fields.map((f) => f.field).join(', ')}.`,
      fields,
    });
    return updated;
  });
  return toEnrollment(result);
}

/**
 * Transfer out: the student leaves the school. Their ACTIVE enrollment ends as TRANSFERRED_OUT and the
 * profile becomes TRANSFERRED_OUT with the reason. Everything is kept; they leave promotion lists.
 */
export async function transferOutStudent(scope, id, { reason }, user, req) {
  const result = await transaction(async (tx) => {
    await lockBranchForStudents(tx, scope, scope.branch.id);
    const student = await findStudent(tx, scope, id);
    if (!['ENROLLED', 'PENDING_ENROLLMENT'].includes(student.status)) {
      throw conflict('INVALID_STATUS', `${fullName(student)} is ${STATUS_LABELS[student.status].toLowerCase()} and cannot be transferred out.`);
    }
    const now = new Date();
    const ended = await tx.enrollment.updateMany({ where: { studentId: student.id, status: 'ACTIVE' }, data: { status: 'TRANSFERRED_OUT', endedAt: now } });
    const updated = await tx.student.update({
      where: { id: student.id },
      data: { status: 'TRANSFERRED_OUT', statusReason: reason, statusChangedAt: now },
      include: { branch: { select: { id: true, name: true, code: true } } },
    });
    await audit(tx, AUDIT_ACTIONS.STUDENT_TRANSFERRED_OUT, updated, {
      scope,
      user,
      req,
      description: `Transferred out: ${reason}${ended.count ? '' : ' (no active enrollment)'}.`,
      fields: [
        { field: 'Status', from: STATUS_LABELS[student.status], to: STATUS_LABELS.TRANSFERRED_OUT },
        { field: 'Reason', from: null, to: reason },
      ],
    });
    return updated;
  });
  return toStudent(result);
}

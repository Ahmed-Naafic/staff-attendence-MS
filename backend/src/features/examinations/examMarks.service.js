import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { createNotifications } from '../notifications/notify.js';
import { findExam } from './examinations.service.js';
import { effectiveExamSettings } from './examSettings.js';

/*
 * Marks (docs/business-rules.md → Examinations → Marks): one sheet per paper and section.
 *
 *   Students   those seated for the paper in the section (the timetable), else the section's students
 *              now enrolled. Absent or excused in examination attendance: no marks (absent counts as
 *              zero in results when the setting says so; excused is left out). Without attendance,
 *              a student can be entered as absent.
 *   Who        the section's teacher of the subject (Staff app) until the deadline (the paper's last
 *              day in the branch + the "days to submit marks" setting); the School Owner or the
 *              branch's Manager (web) any time before approval.
 *   Steps      DRAFT → SUBMITTED (complete) → APPROVED, or RETURNED with a reason (to correct, then
 *              submit again). An approved sheet can be reopened until the results are published.
 *   Opens      once the paper has been sat (its session's day; without a timetable, the examination's
 *              first day) of a scheduled examination.
 * Every save and step is audited; returning a sheet tells its teachers (setting "remind teachers").
 */

const TX = { timeout: 30000, maxWait: 10000 };
const num = (d) => (d === null || d === undefined ? null : Number(d));
const studentName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');
const STATUS = (s) => (s ?? 'DRAFT').toLowerCase();

// ---- the sheet ---------------------------------------------------------------------------------

/** The paper, section and examination of a sheet the actor may see. `scope`: { school, branch } (web) or a teacher. */
async function loadSheetContext(client, { schoolId, branchId, scope }, paperId, sectionId) {
  if (!isUuid(paperId) || !isUuid(sectionId)) throw notFound('Mark sheet not found.');
  const paper = await client.examPaper.findFirst({
    where: { id: paperId, schoolId },
    include: { subject: { select: { id: true, name: true, code: true } }, class: { select: { id: true, name: true } }, examination: { select: { id: true, name: true, status: true, branchId: true, academicYearId: true, startDate: true, endDate: true, academicYear: { select: { status: true } } } } },
  });
  const section = paper
    ? await client.section.findFirst({ where: { id: sectionId, schoolId, classId: paper.classId, academicYearId: paper.examination.academicYearId, ...(branchId && { branchId }) }, select: { id: true, name: true, branchId: true, class: { select: { name: true } }, branch: { select: { id: true, name: true } } } })
    : null;
  if (!paper || !section || (paper.examination.branchId && paper.examination.branchId !== section.branchId)) throw notFound('Mark sheet not found.');
  if (scope) await findExam(client, scope, paper.examination.id);
  const sheet = await client.examMarkSheet.findUnique({ where: { paperId_sectionId: { paperId, sectionId } } });
  return { paper, section, exam: paper.examination, sheet };
}

/** The paper's last day in the branch (its sitting), else the examination's last day; and whether it has been sat. */
async function paperDays(client, paper, branchId, today) {
  const sitting = await client.examSitting.findFirst({ where: { paperId: paper.id, branchId }, select: { session: { select: { date: true } } } });
  const day = sitting ? toDay(sitting.session.date) : null;
  return { satOn: day, opened: paper.examination.status === 'SCHEDULED' && (day ? day <= today : toDay(paper.examination.startDate) <= today), lastDay: day ?? toDay(paper.examination.endDate) };
}

/** Students of the sheet with attendance and marks (results read them too). */
export async function sheetRows(client, paper, section, sheet) {
  const seats = await client.examSeat.findMany({
    where: { sectionId: section.id, sitting: { paperId: paper.id } },
    select: { attendance: true, student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } },
  });
  const students = seats.length
    ? seats.map((s) => ({ student: s.student, attendance: s.attendance?.toLowerCase() ?? null, seated: true }))
    : (await client.enrollment.findMany({ where: { sectionId: section.id, status: 'ACTIVE' }, select: { student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } } })).map((e) => ({ student: e.student, attendance: null, seated: false }));
  const marks = sheet ? await client.examMark.findMany({ where: { sheetId: sheet.id } }) : [];
  return students
    .map((s) => {
      const m = marks.find((x) => x.studentId === s.student.id);
      const away = s.attendance === 'absent' || s.attendance === 'excused';
      return {
        student: { id: s.student.id, name: studentName(s.student), number: s.student.studentNumber },
        attendance: s.attendance,
        // Absent or excused in attendance wins; otherwise what was entered.
        absent: s.attendance === 'absent' || (!away && Boolean(m?.absent)),
        excused: s.attendance === 'excused',
        marks: away ? null : num(m?.marks),
        lockedByAttendance: away,
      };
    })
    .sort((a, b) => a.student.name.localeCompare(b.student.name));
}

const complete = (rows) => rows.every((r) => r.absent || r.excused || r.marks !== null);
const stats = (rows, maxMarks) => {
  const sat = rows.filter((r) => r.marks !== null);
  const total = sat.reduce((n, r) => n + r.marks, 0);
  return {
    students: rows.length,
    entered: rows.filter((r) => r.marks !== null || r.absent || r.excused).length,
    absent: rows.filter((r) => r.absent).length,
    excused: rows.filter((r) => r.excused).length,
    average: sat.length ? Math.round((total / sat.length) * 100) / 100 : null,
    averagePercent: sat.length ? Math.round((total / sat.length / maxMarks) * 10000) / 100 : null,
    highest: sat.length ? Math.max(...sat.map((r) => r.marks)) : null,
    lowest: sat.length ? Math.min(...sat.map((r) => r.marks)) : null,
  };
};

async function teachersOf(client, sectionIds, subjectIds) {
  if (!sectionIds.length) return [];
  return client.teachingAssignment.findMany({
    where: { sectionId: { in: sectionIds }, subjectId: { in: subjectIds }, role: 'SUBJECT_TEACHER', cancelledAt: null },
    select: { sectionId: true, subjectId: true, teacher: { select: { id: true, name: true } } },
  });
}

/** The section's results are approved or published: its sheets stay (reopen the results first). */
async function resultsPublished(client, examId, sectionId) {
  const set = await client.examResultSet.findFirst({ where: { examinationId: examId, sectionId, status: { in: ['APPROVED', 'PUBLISHED'] } }, select: { id: true } });
  return Boolean(set);
}

/** The sheet as shown, with what the actor can do. `as`: 'staff' | 'teacher'. */
async function shapeSheet(client, ctx, { as, today, settings }) {
  const { paper, section, exam, sheet } = ctx;
  const [rows, days, published] = await Promise.all([sheetRows(client, paper, section, sheet), paperDays(client, paper, section.branchId, today), resultsPublished(client, exam.id, section.id)]);
  const deadline = addDays(days.lastDay, settings.markEntryDays);
  const status = STATUS(sheet?.status);
  const open = days.opened && exam.status === 'SCHEDULED' && exam.academicYear.status !== 'CLOSED' && !published;
  const editable = open && (as === 'teacher' ? ['draft', 'returned'].includes(status) && today <= deadline : status !== 'approved');
  return {
    paper: { id: paper.id, subject: paper.subject, class: paper.class, maxMarks: paper.maxMarks },
    section: { id: section.id, name: sectionDisplayName(section.class.name, section.name), branch: section.branch },
    examination: { id: exam.id, name: exam.name },
    status,
    satOn: days.satOn,
    deadline,
    opened: days.opened,
    returnedReason: sheet?.returnedReason ?? null,
    submittedAt: sheet?.submittedAt?.toISOString() ?? null,
    submittedBy: sheet?.submittedByName ?? null,
    approvedAt: sheet?.approvedAt?.toISOString() ?? null,
    approvedBy: sheet?.approvedByName ?? null,
    resultsPublished: published,
    actions: {
      edit: editable,
      submit: editable && complete(rows) && status !== 'submitted' && rows.length > 0,
      approve: as !== 'teacher' && open && status !== 'approved' && complete(rows) && rows.length > 0,
      return: as !== 'teacher' && open && (status === 'submitted' || status === 'approved'),
    },
    stats: stats(rows, paper.maxMarks),
    students: rows,
  };
}

// ---- writing ----------------------------------------------------------------------------------

/** Saves marks: [{ studentId, marks (number | null), absent }]. → number changed. */
async function writeMarks(tx, ctx, entries, user) {
  const { paper, section, exam } = ctx;
  const rows = await sheetRows(tx, paper, section, ctx.sheet);
  const byId = new Map(rows.map((r) => [r.student.id, r]));
  const problems = [];
  for (const e of entries) {
    const row = byId.get(e.studentId);
    if (!row) problems.push('Every student must be on this sheet.');
    else if (row.lockedByAttendance && (e.marks !== null || e.absent)) problems.push(`${row.student.name} is ${row.attendance} in the examination attendance: no marks.`);
    else if (e.marks !== null && e.marks > paper.maxMarks) problems.push(`${row.student.name}: at most ${paper.maxMarks}.`);
    else if (e.marks !== null && e.absent) problems.push(`${row.student.name}: marks or absent, not both.`);
  }
  if (problems.length) throw badRequest('Check the highlighted fields.', { marks: [...new Set(problems)].join(' ') });
  const sheet = await ensureSheet(tx, ctx);
  const existing = await tx.examMark.findMany({ where: { sheetId: sheet.id, studentId: { in: entries.map((e) => e.studentId) } } });
  let changed = 0;
  for (const e of entries) {
    const before = existing.find((x) => x.studentId === e.studentId);
    if (before && num(before.marks) === e.marks && before.absent === e.absent) continue;
    const data = { marks: e.marks === null ? null : new Prisma.Decimal(e.marks), absent: e.absent, updatedById: user.id, updatedByName: user.name };
    if (before) await tx.examMark.update({ where: { id: before.id }, data });
    else await tx.examMark.create({ data: { sheetId: sheet.id, studentId: e.studentId, ...data } });
    changed += 1;
  }
  return changed;
}

/** The sheet row, created when first needed. */
async function ensureSheet(tx, ctx) {
  ctx.sheet ??= await tx.examMarkSheet.create({ data: { schoolId: ctx.paper.schoolId, examinationId: ctx.exam.id, paperId: ctx.paper.id, sectionId: ctx.section.id, branchId: ctx.section.branchId } });
  return ctx.sheet;
}

const audit = (tx, schoolId, user, req, action, ctx, description, change) =>
  recordAuditEvent({ client: tx, action, actor: { id: user.id, name: user.name, role: user.role }, target: { type: 'examination', id: ctx.exam.id, name: ctx.exam.name }, schoolId, description, change, req });
const label = (ctx) => `${ctx.paper.subject.name} · ${sectionDisplayName(ctx.section.class.name, ctx.section.name)}`;

// ---- School Owner and Manager (web) -----------------------------------------------------------

const staffCtx = (scope) => ({ schoolId: scope.school.id, branchId: scope.branch?.id ?? null, scope });

/**
 * Every mark sheet of an examination (papers × sections in the branches the scope sees, filtered by
 * branch / class / subject / status): { examination, today, counts, items }.
 */
export async function listMarkSheets(scope, examId, { branch, classId, subjectId, status }) {
  const prisma = getPrisma();
  const [exam, today] = await Promise.all([findExam(prisma, scope, examId), calendarToday()]);
  const branchId = scope.branch?.id ?? branch ?? exam.branchId ?? null;
  const papers = await prisma.examPaper.findMany({
    where: { examinationId: exam.id, ...(classId && { classId }), ...(subjectId && { subjectId }) },
    include: { subject: { select: { id: true, name: true, code: true } }, class: { select: { id: true, name: true, sequence: true } }, sittings: { select: { branchId: true, session: { select: { date: true } } } } },
  });
  const sections = await prisma.section.findMany({
    where: { classId: { in: [...new Set(papers.map((p) => p.classId))] }, academicYearId: exam.academicYearId, status: 'ACTIVE', ...(exam.branchId ? { branchId: exam.branchId } : branchId && { branchId }) },
    select: { id: true, name: true, classId: true, branchId: true, class: { select: { name: true } }, branch: { select: { id: true, name: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  });
  const [sheets, teachers, settingsByBranch] = await Promise.all([
    prisma.examMarkSheet.findMany({ where: { examinationId: exam.id }, select: { id: true, paperId: true, sectionId: true, status: true, submittedAt: true, approvedAt: true, _count: { select: { marks: { where: { OR: [{ marks: { not: null } }, { absent: true }] } } } } } }),
    teachersOf(prisma, sections.map((s) => s.id), [...new Set(papers.map((p) => p.subjectId))]),
    Promise.all([...new Set(sections.map((s) => s.branchId))].map(async (b) => [b, await effectiveExamSettings(scope.school.id, b, prisma)])).then((e) => new Map(e)),
  ]);
  const items = [];
  for (const p of papers.sort((a, b) => a.class.sequence - b.class.sequence || a.subject.name.localeCompare(b.subject.name))) {
    for (const s of sections.filter((x) => x.classId === p.classId)) {
      const sheet = sheets.find((x) => x.paperId === p.id && x.sectionId === s.id);
      const sitting = p.sittings.find((x) => x.branchId === s.branchId);
      const lastDay = sitting ? toDay(sitting.session.date) : toDay(exam.endDate);
      items.push({
        paper: { id: p.id, subject: p.subject, class: { id: p.class.id, name: p.class.name }, maxMarks: p.maxMarks },
        section: { id: s.id, name: sectionDisplayName(s.class.name, s.name), branch: s.branch },
        status: STATUS(sheet?.status),
        entered: sheet?._count.marks ?? 0,
        students: s._count.enrollments,
        satOn: sitting ? toDay(sitting.session.date) : null,
        deadline: addDays(lastDay, settingsByBranch.get(s.branchId).markEntryDays),
        overdue: STATUS(sheet?.status) !== 'approved' && STATUS(sheet?.status) !== 'submitted' && addDays(lastDay, settingsByBranch.get(s.branchId).markEntryDays) < today,
        teachers: teachers.filter((t) => t.sectionId === s.id && t.subjectId === p.subjectId).map((t) => t.teacher),
        submittedAt: sheet?.submittedAt?.toISOString() ?? null,
        approvedAt: sheet?.approvedAt?.toISOString() ?? null,
      });
    }
  }
  const counts = { draft: 0, submitted: 0, approved: 0, returned: 0 };
  for (const i of items) counts[i.status] += 1;
  return {
    examination: { id: exam.id, name: exam.name, status: exam.status.toLowerCase(), level: exam.branchId ? 'branch' : 'school' },
    today,
    counts,
    items: status && status !== 'all' ? items.filter((i) => i.status === status) : items,
  };
}

export async function getMarkSheet(scope, paperId, sectionId) {
  const prisma = getPrisma();
  const ctx = await loadSheetContext(prisma, staffCtx(scope), paperId, sectionId);
  const [today, settings] = await Promise.all([calendarToday(), effectiveExamSettings(scope.school.id, ctx.section.branchId, prisma)]);
  return shapeSheet(prisma, ctx, { as: 'staff', today, settings });
}

async function staffWrite(scope, paperId, sectionId, work) {
  await getPrisma().$transaction(async (tx) => {
    const ctx = await loadSheetContext(tx, staffCtx(scope), paperId, sectionId);
    if (scope.branch) await lockOperatingBranch(tx, scope, 'marks');
    else await lockActiveSchool(tx, scope.school);
    if (ctx.sheet) await tx.$queryRaw`SELECT "id" FROM "ExamMarkSheet" WHERE "id" = ${ctx.sheet.id} FOR UPDATE`;
    const today = await calendarToday();
    const settings = await effectiveExamSettings(scope.school.id, ctx.section.branchId, tx);
    const shaped = await shapeSheet(tx, ctx, { as: 'staff', today, settings });
    await work(tx, ctx, shaped);
  }, TX);
  return getMarkSheet(scope, paperId, sectionId);
}

const refuse = (shaped, action) => {
  if (!shaped.opened) throw conflict('NOT_OPEN', 'Marks are entered once the paper has been sat.');
  if (shaped.resultsPublished) throw conflict('RESULTS_PUBLISHED', 'The results of this class are approved or published: its marks stay as they are. Reopen the results first.');
  if (action === 'edit' && shaped.status === 'approved') throw conflict('SHEET_APPROVED', 'These marks are approved. Reopen them to change them.');
};

export async function saveMarkSheet(scope, paperId, sectionId, entries, user, req) {
  return staffWrite(scope, paperId, sectionId, async (tx, ctx, shaped) => {
    refuse(shaped, 'edit');
    if (!shaped.actions.edit) throw conflict('NOT_EDITABLE', 'These marks cannot be changed now.');
    const changed = await writeMarks(tx, ctx, entries, user);
    if (changed) await audit(tx, scope.school.id, user, req, AUDIT_ACTIONS.EXAM_MARKS_SAVED, ctx, `Saved ${changed} marks of ${label(ctx)} in ${ctx.exam.name}.`, { fields: ['marks'], sheet: label(ctx), changed });
  });
}

export async function approveMarkSheet(scope, paperId, sectionId, user, req) {
  return staffWrite(scope, paperId, sectionId, async (tx, ctx, shaped) => {
    refuse(shaped, 'approve');
    if (!shaped.actions.approve) throw conflict(shaped.status === 'approved' ? 'SHEET_APPROVED' : 'MARKS_INCOMPLETE', shaped.status === 'approved' ? 'These marks are approved already.' : 'Enter every student’s marks (or absent) first.');
    const sheet = await ensureSheet(tx, ctx);
    await tx.examMarkSheet.update({ where: { id: sheet.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedByName: user.name, returnedReason: null } });
    await audit(tx, scope.school.id, user, req, AUDIT_ACTIONS.EXAM_MARKS_APPROVED, ctx, `Approved the marks of ${label(ctx)} in ${ctx.exam.name}.`, { fields: ['status'], sheet: label(ctx), from: shaped.status, to: 'approved', average: shaped.stats.averagePercent });
  });
}

/** Returns submitted marks (or reopens approved ones) with a reason; the section's teachers of the subject are told. */
export async function returnMarkSheet(scope, paperId, sectionId, { reason }, user, req) {
  return staffWrite(scope, paperId, sectionId, async (tx, ctx, shaped) => {
    refuse(shaped, 'return');
    if (!shaped.actions.return) throw conflict('NOT_SUBMITTED', 'Only submitted or approved marks can be returned.');
    await tx.examMarkSheet.update({ where: { id: ctx.sheet.id }, data: { status: 'RETURNED', returnedReason: reason, approvedAt: null, approvedByName: null } });
    await audit(tx, scope.school.id, user, req, AUDIT_ACTIONS.EXAM_MARKS_RETURNED, ctx, `Returned the marks of ${label(ctx)} in ${ctx.exam.name}: ${reason}`, { fields: ['status'], sheet: label(ctx), from: shaped.status, to: 'returned', reason });
    const settings = await effectiveExamSettings(scope.school.id, ctx.section.branchId, tx);
    if (settings.notifyMarksDue) {
      const teachers = await teachersOf(tx, [ctx.section.id], [ctx.paper.subjectId]);
      await createNotifications(
        teachers.map((t) => ({
          type: 'EXAM_MARKS_RETURNED',
          recipientId: t.teacher.id,
          schoolId: scope.school.id,
          branchId: ctx.section.branchId,
          subjectType: 'exam_mark_sheet',
          subjectId: ctx.sheet.id,
          params: { examination: ctx.exam.name, subject: ctx.paper.subject.name, section: sectionDisplayName(ctx.section.class.name, ctx.section.name), reason, deadline: shaped.deadline },
          dedupeKey: `exam-marks-returned:${ctx.sheet.id}:${Date.now()}:${t.teacher.id}`,
        })),
        { client: tx },
      );
    }
  });
}

/** Submits for approval on behalf (e.g. marks entered from paper by the Manager): same rules as a teacher's submit. */
export async function submitMarkSheet(scope, paperId, sectionId, user, req) {
  return staffWrite(scope, paperId, sectionId, async (tx, ctx, shaped) => {
    refuse(shaped, 'submit');
    if (!shaped.actions.submit) throw conflict('MARKS_INCOMPLETE', 'Enter every student’s marks (or absent) first.');
    await tx.examMarkSheet.update({ where: { id: (await ensureSheet(tx, ctx)).id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedByName: user.name, returnedReason: null } });
    await audit(tx, scope.school.id, user, req, AUDIT_ACTIONS.EXAM_MARKS_SUBMITTED, ctx, `Submitted the marks of ${label(ctx)} in ${ctx.exam.name}.`, { fields: ['status'], sheet: label(ctx), from: shaped.status, to: 'submitted' });
  });
}

// ---- teachers (Staff app) ---------------------------------------------------------------------

const teacherCtx = (teacher) => ({ schoolId: teacher.school.id, branchId: null, scope: null });

async function teaches(client, teacher, ctx) {
  const a = await client.teachingAssignment.findFirst({ where: { teacherId: teacher.id, sectionId: ctx.section.id, subjectId: ctx.paper.subjectId, role: 'SUBJECT_TEACHER', cancelledAt: null }, select: { id: true } });
  if (!a) throw notFound('Mark sheet not found.');
}

/**
 * The teacher's mark sheets: papers of scheduled examinations (ending from 60 days ago on) for the
 * sections and subjects they teach: { date, items: [{ paper, section, examination, status, deadline, opened, entered, students }] }.
 */
export async function teacherSheets(teacher) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const assignments = await prisma.teachingAssignment.findMany({
    where: { teacherId: teacher.id, schoolId: teacher.school.id, role: 'SUBJECT_TEACHER', cancelledAt: null, subjectId: { not: null } },
    select: { sectionId: true, subjectId: true, section: { select: { id: true, name: true, classId: true, branchId: true, academicYearId: true, class: { select: { name: true } }, branch: { select: { id: true, name: true } } } } },
  });
  const items = [];
  for (const a of assignments) {
    const papers = await prisma.examPaper.findMany({
      where: {
        classId: a.section.classId,
        subjectId: a.subjectId,
        examination: { status: 'SCHEDULED', academicYearId: a.section.academicYearId, endDate: { gte: asDbDay(addDays(today, -60)) }, OR: [{ branchId: null }, { branchId: a.section.branchId }] },
      },
      include: { subject: { select: { id: true, name: true, code: true } }, class: { select: { id: true, name: true } }, examination: { select: { id: true, name: true, status: true, branchId: true, academicYearId: true, startDate: true, endDate: true, academicYear: { select: { status: true } } } } },
    });
    for (const p of papers) {
      const ctx = { paper: p, section: a.section, exam: p.examination, sheet: await prisma.examMarkSheet.findUnique({ where: { paperId_sectionId: { paperId: p.id, sectionId: a.section.id } } }) };
      const settings = await effectiveExamSettings(teacher.school.id, a.section.branchId, prisma);
      const s = await shapeSheet(prisma, ctx, { as: 'teacher', today, settings });
      items.push({ paper: s.paper, section: s.section, examination: s.examination, status: s.status, deadline: s.deadline, opened: s.opened, satOn: s.satOn, canEdit: s.actions.edit, entered: s.stats.entered, students: s.stats.students });
    }
  }
  items.sort((a, b) => (a.deadline + a.section.name).localeCompare(b.deadline + b.section.name));
  return { date: today, items };
}

export async function teacherSheet(teacher, paperId, sectionId) {
  const prisma = getPrisma();
  const ctx = await loadSheetContext(prisma, teacherCtx(teacher), paperId, sectionId);
  await teaches(prisma, teacher, ctx);
  const [today, settings] = await Promise.all([calendarToday(), effectiveExamSettings(teacher.school.id, ctx.section.branchId, prisma)]);
  return shapeSheet(prisma, ctx, { as: 'teacher', today, settings });
}

async function teacherWrite(teacher, paperId, sectionId, work) {
  await getPrisma().$transaction(async (tx) => {
    const ctx = await loadSheetContext(tx, teacherCtx(teacher), paperId, sectionId);
    await teaches(tx, teacher, ctx);
    if (ctx.sheet) await tx.$queryRaw`SELECT "id" FROM "ExamMarkSheet" WHERE "id" = ${ctx.sheet.id} FOR UPDATE`;
    const today = await calendarToday();
    const settings = await effectiveExamSettings(teacher.school.id, ctx.section.branchId, tx);
    const shaped = await shapeSheet(tx, ctx, { as: 'teacher', today, settings });
    refuse(shaped, 'teacher');
    if (!shaped.actions.edit) {
      if (shaped.status === 'submitted') throw conflict('SHEET_SUBMITTED', 'These marks are submitted. Ask your Manager to return them to change them.');
      if (shaped.status === 'approved') throw conflict('SHEET_APPROVED', 'These marks are approved.');
      throw conflict('DEADLINE_PASSED', `Marks were due by ${shaped.deadline}. Ask your Manager to enter them.`);
    }
    await work(tx, ctx, shaped);
  }, TX);
  return teacherSheet(teacher, paperId, sectionId);
}

export async function saveTeacherMarks(teacher, paperId, sectionId, entries, req) {
  const user = { ...teacher, role: 'STAFF' };
  return teacherWrite(teacher, paperId, sectionId, async (tx, ctx) => {
    const changed = await writeMarks(tx, ctx, entries, user);
    if (changed) await audit(tx, teacher.school.id, user, req, AUDIT_ACTIONS.EXAM_MARKS_SAVED, ctx, `Saved ${changed} marks of ${label(ctx)} in ${ctx.exam.name}.`, { fields: ['marks'], sheet: label(ctx), changed });
  });
}

export async function submitTeacherMarks(teacher, paperId, sectionId, req) {
  const user = { ...teacher, role: 'STAFF' };
  return teacherWrite(teacher, paperId, sectionId, async (tx, ctx, shaped) => {
    if (!shaped.actions.submit) throw conflict('MARKS_INCOMPLETE', 'Enter every student’s marks (or absent) first.');
    await tx.examMarkSheet.update({ where: { id: (await ensureSheet(tx, ctx)).id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedByName: teacher.name, returnedReason: null } });
    await audit(tx, teacher.school.id, user, req, AUDIT_ACTIONS.EXAM_MARKS_SUBMITTED, ctx, `Submitted the marks of ${label(ctx)} in ${ctx.exam.name}.`, { fields: ['status'], sheet: label(ctx), from: shaped.status, to: 'submitted' });
  });
}


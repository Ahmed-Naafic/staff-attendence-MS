import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { PdfReport } from '../../common/unicodePdf.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { asDbDay, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { createNotifications } from '../notifications/notify.js';
import { findExam } from './examinations.service.js';
import { sheetRows } from './examMarks.service.js';
import { effectiveExamSettings } from './examSettings.js';
import { computeSection, gradeFor, summarize, yearFinal } from './resultsEngine.js';

/*
 * Results, report cards and the year's final result (docs/business-rules.md → Examinations → Results).
 *
 *   DRAFT      calculated live from the marks (resultsEngine.js); nothing is final.
 *   APPROVED   once every paper's marks of the section are approved, the School Owner or the branch's
 *              Manager approves the results: they are stored as calculated (the next revision); marks
 *              and attendance of the class are fixed. Reopening goes back to DRAFT.
 *   PUBLISHED  the School Owner publishes them (a Manager too for their branch's own examinations): the
 *              revision is recorded; report cards print it. Within the correction days after publishing,
 *              they can be reopened with a reason; the next publication is a new revision and the
 *              earlier ones stay in the history.
 * The year's final result combines each student's published results with the year's formula; it is
 * handed to Promotion by setting the enrollments' year-end result (Passed / Failed).
 */

const num = (d) => (d === null || d === undefined ? null : Number(d));
const STATUS = (s) => (s ?? 'DRAFT').toLowerCase();
const studentName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

// ---- inputs ------------------------------------------------------------------------------------

/** The grading scale bands of an examination type (its own scale, else the school default). */
async function bandsFor(client, schoolId, examTypeId) {
  const type = await client.examType.findUnique({ where: { id: examTypeId }, select: { gradingScaleId: true } });
  const scale = type?.gradingScaleId
    ? await client.gradingScale.findUnique({ where: { id: type.gradingScaleId }, include: { bands: true } })
    : await client.gradingScale.findFirst({ where: { schoolId, isDefault: true }, include: { bands: true } });
  return { name: scale?.name ?? null, bands: (scale?.bands ?? []).map((b) => ({ label: b.label, minPercent: num(b.minPercent), maxPercent: num(b.maxPercent), points: num(b.points), passes: b.passes, remark: b.remark })) };
}

/** Everything the calculation needs for one section: papers, students, entries, sheets' states, settings, scale. */
async function sectionInputs(client, exam, section) {
  const papers = await client.examPaper.findMany({ where: { examinationId: exam.id, classId: section.classId }, include: { subject: { select: { id: true, name: true } } }, orderBy: { subject: { name: 'asc' } } });
  const sheets = await client.examMarkSheet.findMany({ where: { examinationId: exam.id, sectionId: section.id } });
  const students = new Map();
  const entries = new Map();
  for (const p of papers) {
    const rows = await sheetRows(client, { id: p.id }, { id: section.id }, sheets.find((s) => s.paperId === p.id) ?? null);
    for (const r of rows) {
      students.set(r.student.id, r.student);
      entries.set(`${p.id}|${r.student.id}`, { marks: r.marks, absent: r.absent, excused: r.excused });
    }
  }
  const [settings, scale] = await Promise.all([effectiveExamSettings(exam.schoolId, section.branchId, client), bandsFor(client, exam.schoolId, exam.examTypeId)]);
  const approved = papers.filter((p) => sheets.some((s) => s.paperId === p.id && s.status === 'APPROVED')).length;
  return {
    papers: papers.map((p) => ({ id: p.id, subject: p.subject.name, maxMarks: p.maxMarks })),
    students: [...students.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entries,
    settings,
    scale,
    sheets: { approved, total: papers.length },
  };
}

const toStored = (r) => ({
  student: r.student,
  papers: r.papers,
  totalMarks: num(r.totalMarks),
  totalMax: r.totalMax,
  percent: num(r.percent),
  grade: r.grade,
  points: num(r.points),
  remark: r.remark ?? null,
  passed: r.passed,
  failedPapers: r.failedPapers,
  rank: r.rank,
});

async function storedResults(client, set, revision) {
  const rows = await client.examResult.findMany({ where: { resultSetId: set.id, revision }, include: { student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } } });
  return rows
    .map((r) => toStored({ ...r, student: { id: r.student.id, name: studentName(r.student), number: r.student.studentNumber } }))
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.student.name.localeCompare(b.student.name));
}

/**
 * A section's results as they stand: stored (approved or published) or live (draft).
 * → { status, provisional, papers: [{ id, subject, maxMarks }], students }.
 */
export async function resultsForSection(client, exam, section) {
  const set = await client.examResultSet.findUnique({ where: { examinationId_sectionId: { examinationId: exam.id, sectionId: section.id } } });
  const status = STATUS(set?.status);
  if (status === 'draft') {
    const input = await sectionInputs(client, exam, section);
    return { status, provisional: true, papers: input.papers, students: computeSection({ ...input, bands: input.scale.bands }).students };
  }
  const students = await storedResults(client, set, status === 'approved' ? set.revision + 1 : set.revision);
  const papers = students[0]?.papers.map((p) => ({ id: p.paperId, subject: p.subject, maxMarks: p.maxMarks })) ?? [];
  return { status, provisional: status !== 'published', papers, students };
}

// ---- scope helpers -----------------------------------------------------------------------------

async function sectionOf(client, scope, exam, sectionId) {
  const section = isUuid(sectionId)
    ? await client.section.findFirst({
        where: { id: sectionId, schoolId: scope.school.id, academicYearId: exam.academicYearId, classId: { in: exam.classes.map((c) => c.class.id) }, ...(exam.branchId && { branchId: exam.branchId }), ...(scope.branch && { branchId: scope.branch.id }) },
        select: { id: true, name: true, classId: true, branchId: true, class: { select: { name: true } }, branch: { select: { id: true, name: true } } },
      })
    : null;
  if (!section) throw notFound('Class not found in this examination.');
  return section;
}

const canPublish = (scope, exam) => !scope.branch || exam.branchId === scope.branch.id;
const sectionName = (s) => sectionDisplayName(s.class.name, s.name);

// ---- reading ----------------------------------------------------------------------------------

/** Every section of an examination the scope sees, with its results' state and figures. */
export async function listResults(scope, examId, { branch }) {
  const prisma = getPrisma();
  const exam = await findExam(prisma, scope, examId);
  const branchId = scope.branch?.id ?? exam.branchId ?? branch ?? null;
  const sections = await prisma.section.findMany({
    where: { schoolId: scope.school.id, academicYearId: exam.academicYearId, status: 'ACTIVE', classId: { in: exam.classes.map((c) => c.class.id) }, ...(branchId && { branchId }) },
    select: { id: true, name: true, classId: true, branchId: true, class: { select: { name: true, sequence: true } }, branch: { select: { id: true, name: true } } },
    orderBy: [{ class: { sequence: 'asc' } }, { nameKey: 'asc' }],
  });
  const sets = await prisma.examResultSet.findMany({ where: { examinationId: exam.id, sectionId: { in: sections.map((s) => s.id) } } });
  const items = [];
  for (const s of sections) {
    const set = sets.find((x) => x.sectionId === s.id) ?? null;
    const status = STATUS(set?.status);
    let summary;
    let sheets;
    if (status === 'draft') {
      const input = await sectionInputs(prisma, exam, s);
      summary = computeSection({ ...input, bands: input.scale.bands }).summary;
      sheets = input.sheets;
    } else {
      const stored = await storedResults(prisma, set, status === 'approved' ? set.revision + 1 : set.revision);
      summary = summarize(stored.map((r) => ({ ...r, missingPapers: 0 })), []);
      sheets = null;
    }
    items.push({
      section: { id: s.id, name: sectionName(s), branch: s.branch, class: { id: s.classId, name: s.class.name } },
      status,
      revision: set?.revision ?? 0,
      sheets,
      summary: { students: summary.students, passed: summary.passed, passRate: summary.passRate, average: summary.average },
      publishedAt: set?.publishedAt?.toISOString() ?? null,
      actions: { approve: status === 'draft' && sheets?.approved === sheets?.total && sheets?.total > 0, publish: status === 'approved' && canPublish(scope, exam) },
    });
  }
  const counts = { draft: 0, approved: 0, published: 0 };
  for (const i of items) counts[i.status] += 1;
  return { examination: { id: exam.id, name: exam.name, level: exam.branchId ? 'branch' : 'school', status: exam.status.toLowerCase() }, counts, items };
}

/** One section's results: live (draft) or as approved/published, with the publication history. */
export async function getSectionResults(scope, examId, sectionId) {
  const prisma = getPrisma();
  const exam = await findExam(prisma, scope, examId);
  const section = await sectionOf(prisma, scope, exam, sectionId);
  const [set, today] = await Promise.all([prisma.examResultSet.findUnique({ where: { examinationId_sectionId: { examinationId: exam.id, sectionId: section.id } }, include: { revisions: { orderBy: { revision: 'desc' } } } }), calendarToday()]);
  const status = STATUS(set?.status);
  const input = await sectionInputs(prisma, exam, section);
  let students;
  let papers = input.papers;
  if (status === 'draft') students = computeSection({ ...input, bands: input.scale.bands }).students;
  else {
    students = await storedResults(prisma, set, status === 'approved' ? set.revision + 1 : set.revision);
    papers = students[0]?.papers.map((p) => ({ id: p.paperId, subject: p.subject, maxMarks: p.maxMarks })) ?? papers;
  }
  const summary = summarize(students.map((r) => ({ ...r, missingPapers: r.missingPapers ?? 0 })), papers);
  const correctUntil = set?.publishedAt ? toDay(new Date(set.publishedAt.getTime() + input.settings.publishedCorrectionDays * 86_400_000)) : null;
  return {
    examination: { id: exam.id, name: exam.name },
    section: { id: section.id, name: sectionName(section), branch: section.branch },
    status,
    revision: set?.revision ?? 0,
    live: status === 'draft',
    scale: input.scale.name,
    sheets: input.sheets,
    settings: { passPercent: input.settings.passPercent, overallPassPercent: input.settings.overallPassPercent, maxFailedSubjects: input.settings.maxFailedSubjects, absentCountsAsZero: input.settings.absentCountsAsZero, showRank: input.settings.reportShowRank, showAttendance: input.settings.reportShowAttendance },
    approvedAt: set?.approvedAt?.toISOString() ?? null,
    approvedBy: set?.approvedByName ?? null,
    publishedAt: set?.publishedAt?.toISOString() ?? null,
    publishedBy: set?.publishedByName ?? null,
    correctionReason: set?.correctionReason ?? null,
    correctUntil,
    papers,
    students,
    summary,
    revisions: (set?.revisions ?? []).map((r) => ({ revision: r.revision, publishedAt: r.publishedAt.toISOString(), publishedBy: r.publishedByName, reason: r.reason, summary: r.summary })),
    actions: {
      approve: status === 'draft' && exam.status === 'SCHEDULED' && input.sheets.total > 0 && input.sheets.approved === input.sheets.total,
      reopen: status === 'approved',
      publish: status === 'approved' && canPublish(scope, exam),
      correct: status === 'published' && canPublish(scope, exam) && today <= correctUntil,
    },
  };
}

// ---- steps ------------------------------------------------------------------------------------

async function withSet(scope, examId, sectionId, work) {
  return getPrisma().$transaction(
    async (tx) => {
      const exam = await findExam(tx, scope, examId);
      const section = await sectionOf(tx, scope, exam, sectionId);
      if (scope.branch) await lockOperatingBranch(tx, scope, 'results');
      else await lockActiveSchool(tx, scope.school);
      await tx.examResultSet.upsert({ where: { examinationId_sectionId: { examinationId: exam.id, sectionId: section.id } }, create: { schoolId: scope.school.id, examinationId: exam.id, sectionId: section.id, branchId: section.branchId }, update: {} });
      const [set] = await tx.$queryRaw`SELECT "id" FROM "ExamResultSet" WHERE "examinationId" = ${exam.id} AND "sectionId" = ${section.id} FOR UPDATE`;
      const row = await tx.examResultSet.findUnique({ where: { id: set.id } });
      return work(tx, { exam, section, set: row });
    },
    { timeout: 30000, maxWait: 10000 },
  );
}

const audit = (tx, scope, user, req, action, exam, section, description, change) =>
  recordAuditEvent({ client: tx, action, actor: { id: user.id, name: user.name, role: user.role }, target: { type: 'examination', id: exam.id, name: `${exam.name} (${sectionName(section)})` }, schoolId: scope.school.id, description, change, req });

async function notify(tx, scope, type, exam, section, recipients, params) {
  const settings = await effectiveExamSettings(scope.school.id, section.branchId, tx);
  if (!settings.notifyResults || !recipients.length) return;
  await createNotifications(
    recipients.map((id) => ({ type, recipientId: id, schoolId: scope.school.id, branchId: section.branchId, subjectType: 'exam_result_set', subjectId: exam.id, params: { examination: exam.name, section: sectionName(section), ...params }, dedupeKey: `${type}:${exam.id}:${section.id}:${Date.now()}:${id}` })),
    { client: tx },
  );
}

/** Approves a section's results (every paper's marks approved): stored as the next revision. */
export async function approveResults(scope, examId, sectionId, user, req) {
  await withSet(scope, examId, sectionId, async (tx, { exam, section, set }) => {
    if (set.status !== 'DRAFT') throw conflict('RESULTS_NOT_DRAFT', 'These results are approved or published already.');
    if (exam.status !== 'SCHEDULED') throw conflict('NOT_SCHEDULED', `${exam.name} is not scheduled.`);
    const input = await sectionInputs(tx, exam, section);
    if (!input.sheets.total || input.sheets.approved < input.sheets.total) throw conflict('MARKS_NOT_APPROVED', `Approve the marks of every paper first (${input.sheets.approved} of ${input.sheets.total}).`);
    const { students, summary } = computeSection({ ...input, bands: input.scale.bands });
    const revision = set.revision + 1;
    await tx.examResult.deleteMany({ where: { resultSetId: set.id, revision } });
    await tx.examResult.createMany({
      data: students.map((r) => ({ resultSetId: set.id, revision, studentId: r.student.id, papers: r.papers, totalMarks: r.totalMarks, totalMax: r.totalMax, percent: r.percent, grade: r.grade, points: r.points, remark: r.remark, passed: r.passed, failedPapers: r.failedPapers, rank: r.rank })),
    });
    await tx.examResultSet.update({ where: { id: set.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedByName: user.name } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_RESULTS_APPROVED, exam, section, `Approved the results of ${sectionName(section)} in ${exam.name}: ${summary.passed} of ${summary.withResult} passed.`, { fields: ['status'], to: 'approved', revision, passed: summary.passed, students: summary.students, average: summary.average });
    // A Manager's approval waits for the School Owner to publish (school-wide examinations).
    if (scope.branch && !exam.branchId) {
      const school = await tx.school.findUnique({ where: { id: scope.school.id }, select: { ownerId: true } });
      if (school?.ownerId) await notify(tx, scope, 'EXAM_RESULTS_APPROVED', exam, section, [school.ownerId], { by: user.name });
    }
  });
  return getSectionResults(scope, examId, sectionId);
}

/** Back to draft before publication (the stored revision in waiting is dropped). */
export async function reopenResults(scope, examId, sectionId, user, req) {
  await withSet(scope, examId, sectionId, async (tx, { exam, section, set }) => {
    if (set.status !== 'APPROVED') throw conflict('RESULTS_NOT_APPROVED', 'Only approved results can be reopened. Published results are corrected instead.');
    await tx.examResult.deleteMany({ where: { resultSetId: set.id, revision: set.revision + 1 } });
    await tx.examResultSet.update({ where: { id: set.id }, data: { status: 'DRAFT', approvedAt: null, approvedByName: null } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_RESULTS_REOPENED, exam, section, `Reopened the results of ${sectionName(section)} in ${exam.name}.`, { fields: ['status'], from: 'approved', to: 'draft' });
  });
  return getSectionResults(scope, examId, sectionId);
}

/** Publishes approved results: the revision is recorded; the branch's Managers are told. */
export async function publishResults(scope, examId, sectionId, user, req) {
  await withSet(scope, examId, sectionId, async (tx, ctx) => publishOne(tx, scope, ctx, user, req));
  return getSectionResults(scope, examId, sectionId);
}

async function publishOne(tx, scope, { exam, section, set }, user, req) {
  if (set.status !== 'APPROVED') throw conflict('RESULTS_NOT_APPROVED', 'Approve the results before publishing them.');
  if (!canPublish(scope, exam)) throw forbidden('The School Owner publishes the results of school-wide examinations.');
  const revision = set.revision + 1;
  const stored = await storedResults(tx, set, revision);
  const summary = summarize(stored.map((r) => ({ ...r, missingPapers: 0 })), []);
  const now = new Date();
  await tx.examResultRevision.create({ data: { resultSetId: set.id, revision, publishedAt: now, publishedByName: user.name, reason: set.correctionReason, summary: { students: summary.students, passed: summary.passed, passRate: summary.passRate, average: summary.average } } });
  await tx.examResultSet.update({ where: { id: set.id }, data: { status: 'PUBLISHED', revision, publishedAt: now, publishedByName: user.name, correctionReason: null } });
  await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_RESULTS_PUBLISHED, exam, section, `Published the results of ${sectionName(section)} in ${exam.name}${revision > 1 ? ` (correction ${revision - 1})` : ''}.`, { fields: ['status'], to: 'published', revision, passed: summary.passed, students: summary.students });
  if (!scope.branch) {
    const managers = await tx.user.findMany({ where: { role: 'MANAGER', status: 'ACTIVE', branchId: section.branchId }, select: { id: true } });
    await notify(tx, scope, 'EXAM_RESULTS_PUBLISHED', exam, section, managers.map((m) => m.id), { revision });
  }
}

/** Publishes every approved section of an examination the scope may publish: { published }. */
export async function publishAllResults(scope, examId, { branch }, user, req) {
  const list = await listResults(scope, examId, { branch });
  let published = 0;
  for (const item of list.items.filter((i) => i.actions.publish)) {
    await withSet(scope, examId, item.section.id, async (tx, ctx) => publishOne(tx, scope, ctx, user, req));
    published += 1;
  }
  return { published, ...(await listResults(scope, examId, { branch })) };
}

/** Reopens published results for a correction (within the correction days), with a reason. */
export async function correctResults(scope, examId, sectionId, { reason }, user, req) {
  const today = await calendarToday();
  await withSet(scope, examId, sectionId, async (tx, { exam, section, set }) => {
    if (set.status !== 'PUBLISHED') throw conflict('RESULTS_NOT_PUBLISHED', 'Only published results are corrected.');
    if (!canPublish(scope, exam)) throw forbidden('The School Owner corrects the results of school-wide examinations.');
    const { publishedCorrectionDays } = await effectiveExamSettings(scope.school.id, section.branchId, tx);
    const until = toDay(new Date(set.publishedAt.getTime() + publishedCorrectionDays * 86_400_000));
    if (today > until) throw conflict('CORRECTION_PERIOD_OVER', `Results can be corrected until ${until} (${publishedCorrectionDays} days after publication).`);
    await tx.examResultSet.update({ where: { id: set.id }, data: { status: 'DRAFT', approvedAt: null, approvedByName: null, correctionReason: reason } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_RESULTS_CORRECTION_OPENED, exam, section, `Reopened the published results of ${sectionName(section)} in ${exam.name} for a correction: ${reason}`, { fields: ['status'], from: 'published', to: 'draft', reason, revision: set.revision });
  });
  return getSectionResults(scope, examId, sectionId);
}

// ---- report cards -----------------------------------------------------------------------------

/** Attendance of the students (half-day sessions) from..to: Map studentId → { present, late, absent, excused }. */
async function attendanceOf(client, studentIds, from, to) {
  if (!studentIds.length) return new Map();
  const rows = await client.studentAttendanceEntry.groupBy({
    by: ['studentId', 'status'],
    where: { studentId: { in: studentIds }, status: { not: null }, session: { kind: 'HALF_DAY', date: { gte: asDbDay(from), lte: asDbDay(to) } } },
    _count: { _all: true },
  });
  const out = new Map();
  for (const r of rows) {
    const s = out.get(r.studentId) ?? { present: 0, late: 0, absent: 0, excused: 0 };
    s[r.status.toLowerCase()] = (s[r.status.toLowerCase()] ?? 0) + r._count._all;
    out.set(r.studentId, s);
  }
  return out;
}

/** Report cards of a section (one page per student): approved or published results; drafts are labelled. */
export async function reportCards(scope, examId, sectionId, { student } = {}) {
  const prisma = getPrisma();
  const r = await getSectionResults(scope, examId, sectionId);
  const exam = await prisma.examination.findUnique({ where: { id: examId }, select: { startDate: true, endDate: true, academicYear: { select: { name: true, startDate: true } }, academicPeriod: { select: { name: true, startDate: true } }, examType: { select: { name: true } }, school: { select: { name: true, studentAttendanceEnabled: true } } } });
  const students = student ? r.students.filter((s) => s.student.id === student) : r.students;
  if (!students.length) throw notFound('No results to print.');
  const from = toDay(exam.academicPeriod?.startDate ?? exam.academicYear.startDate);
  const to = toDay(exam.endDate);
  const attendance = r.settings.showAttendance && exam.school.studentAttendanceEnabled ? await attendanceOf(prisma, students.map((s) => s.student.id), from, to) : null;
  const state = r.status === 'published' ? '' : r.status === 'approved' ? ' · approved, not published' : ' · DRAFT: not approved';
  const doc = new PdfReport({ title: `Report card · ${r.examination.name}`, subtitle: `${exam.academicYear.name}${exam.academicPeriod ? ` · ${exam.academicPeriod.name}` : ''} · ${r.section.name} · ${r.section.branch.name}${state}`, school: exam.school.name });
  students.forEach((s, i) => {
    if (i) doc.newPage();
    doc.facts([
      ['Student', s.student.name],
      ['Admission No.', s.student.number],
      ['Class', r.section.name],
    ]);
    doc.table(
      [{ label: 'Subject', width: 2.4, bold: true }, { label: 'Marks', width: 1, align: 'right' }, { label: 'Out of', width: 0.8, align: 'right' }, { label: '%', width: 0.8, align: 'right' }, { label: 'Grade', width: 0.8 }, { label: 'Result', width: 1 }],
      s.papers.map((p) => [p.subject, p.status === 'absent' ? 'Absent' : p.status === 'excused' ? 'Excused' : (p.marks ?? '—').toString(), String(p.maxMarks), p.percent === null ? '—' : p.percent.toFixed(2), p.grade ?? '—', p.passed === null ? '—' : p.passed ? 'Pass' : 'Fail']),
      { minRowHeight: 20 },
    );
    const facts = [
      ['Total', `${s.totalMarks} / ${s.totalMax}`],
      ['Percentage', s.percent === null ? '—' : `${s.percent.toFixed(2)} %`],
      ['Grade', s.grade ?? '—'],
      ['Result', s.passed === null ? 'Incomplete' : s.passed ? 'Passed' : 'Not passed'],
    ];
    if (r.settings.showRank && s.rank) facts.push(['Position in class', `${s.rank} of ${r.summary.withResult}`]);
    if (attendance) {
      const a = attendance.get(s.student.id) ?? { present: 0, late: 0, absent: 0, excused: 0 };
      facts.push(['Attendance (half days)', `${a.present} present · ${a.late} late · ${a.absent} absent · ${a.excused} excused`]);
    }
    doc.facts(facts, 2);
    if (s.remark) doc.paragraph(`Remark: ${s.remark}`, { font: 'italic' });
    doc.paragraph(`Pass marks: ${r.settings.passPercent} % a paper; ${r.settings.overallPassPercent} % overall with at most ${r.settings.maxFailedSubjects} paper(s) failed. ${r.settings.absentCountsAsZero ? 'An absent paper counts as zero.' : 'An absent paper is left out.'}`, { size: 8 });
    doc.ensure(50);
    doc.y += 24;
    for (const [k, x] of [['Class teacher', 0], ['Head of school', 260]]) {
      doc.doc.line(doc.margin + x, doc.y, doc.margin + x + 200, doc.y, '8794A8');
      doc.doc.text(k, doc.margin + x, doc.y + 12, { size: 8, color: '6B7A90' });
    }
  });
  const safe = (t) => String(t).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return { buffer: doc.toBuffer(), filename: `report-cards-${safe(r.examination.name)}-${safe(r.section.name)}.pdf`, missingCharacters: doc.doc.missingCharacters };
}

// ---- the year's final result -------------------------------------------------------------------

async function yearOf(client, scope, value) {
  const year = value === 'current' ? await client.academicYear.findFirst({ where: { schoolId: scope.school.id, status: 'CURRENT' } }) : isUuid(value) ? await client.academicYear.findFirst({ where: { id: value, schoolId: scope.school.id } }) : null;
  if (!year) throw notFound('Academic year not found.');
  return year;
}

/**
 * Final results of a section for the year: each student's published examination results combined with
 * the year's formula: { academicYear, section, formula, examinations, students: [{ student, exams,
 * percent, grade, passed, basis, enrollmentResult }] }.
 */
export async function finalResults(scope, { academicYear, section: sectionId }) {
  const prisma = getPrisma();
  const year = await yearOf(prisma, scope, academicYear);
  const section = isUuid(sectionId) ? await prisma.section.findFirst({ where: { id: sectionId, schoolId: scope.school.id, academicYearId: year.id, ...(scope.branch && { branchId: scope.branch.id }) }, include: { class: { select: { name: true } }, branch: { select: { id: true, name: true } } } }) : null;
  if (!section) throw badRequest('Choose a class of the year.', { section: 'Choose a class of the year.' });
  return computeFinal(prisma, scope, year, section);
}

async function computeFinal(client, scope, year, section) {
  const [formula, sets, enrollments, settings, defaultScale] = await Promise.all([
    client.resultFormula.findUnique({ where: { academicYearId: year.id } }),
    client.examResultSet.findMany({ where: { sectionId: section.id, revision: { gt: 0 }, examination: { academicYearId: year.id, status: 'SCHEDULED' } }, include: { examination: { select: { id: true, name: true, examTypeId: true, academicPeriodId: true, endDate: true } } } }),
    client.enrollment.findMany({ where: { sectionId: section.id, status: 'ACTIVE' }, select: { id: true, result: true, student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } } }),
    effectiveExamSettings(scope.school.id, section.branchId, client),
    client.gradingScale.findFirst({ where: { schoolId: scope.school.id, isDefault: true }, include: { bands: true } }),
  ]);
  const results = sets.length ? await client.examResult.findMany({ where: { OR: sets.map((s) => ({ resultSetId: s.id, revision: s.revision })) }, select: { resultSetId: true, studentId: true, percent: true } }) : [];
  const bands = (defaultScale?.bands ?? []).map((b) => ({ label: b.label, minPercent: num(b.minPercent), points: num(b.points), passes: b.passes, remark: b.remark }));
  const exams = sets.map((s) => s.examination).sort((a, b) => (a.endDate < b.endDate ? -1 : 1));
  const students = enrollments.map((e) => {
    const mine = sets.map((s) => ({ examId: s.examination.id, examTypeId: s.examination.examTypeId, periodId: s.examination.academicPeriodId, endDate: toDay(s.examination.endDate), percent: num(results.find((r) => r.resultSetId === s.id && r.studentId === e.student.id)?.percent) }));
    const final = yearFinal(mine, formula && { method: formula.method, typeWeights: formula.typeWeights, periodWeights: formula.periodWeights });
    return {
      enrollmentId: e.id,
      student: { id: e.student.id, name: studentName(e.student), number: e.student.studentNumber },
      exams: mine.map((m) => ({ examId: m.examId, percent: m.percent })),
      percent: final.percent,
      basis: final.basis,
      grade: gradeFor(bands, final.percent)?.label ?? null,
      passed: final.percent === null ? null : final.percent >= settings.overallPassPercent,
      enrollmentResult: e.result?.toLowerCase() ?? null,
    };
  });
  return {
    academicYear: { id: year.id, name: year.name, status: year.status.toLowerCase() },
    section: { id: section.id, name: sectionDisplayName(section.class.name, section.name), branch: section.branch },
    formula: formula ? { method: formula.method.toLowerCase() } : null,
    passPercent: settings.overallPassPercent,
    examinations: exams.map((x) => ({ id: x.id, name: x.name })),
    students: students.sort((a, b) => a.student.name.localeCompare(b.student.name)),
  };
}

/**
 * Hands final results to Promotion: sets each active enrollment's year-end result (Passed / Failed) of
 * the section from its final result. Results already recorded stay unless `overwrite`. → { set, kept, none }.
 */
export async function handOverFinalResults(scope, { academicYear, section: sectionId, overwrite }, user, req) {
  const prisma = getPrisma();
  const year = await yearOf(prisma, scope, academicYear);
  return prisma.$transaction(
    async (tx) => {
      if (scope.branch) await lockOperatingBranch(tx, scope, 'final results');
      else await lockActiveSchool(tx, scope.school);
      const section = isUuid(sectionId) ? await tx.section.findFirst({ where: { id: sectionId, schoolId: scope.school.id, academicYearId: year.id, ...(scope.branch && { branchId: scope.branch.id }) }, include: { class: { select: { name: true } }, branch: { select: { id: true, name: true } } } }) : null;
      if (!section) throw badRequest('Choose a class of the year.', { section: 'Choose a class of the year.' });
      const final = await computeFinal(tx, scope, year, section);
      let set = 0;
      let kept = 0;
      let none = 0;
      for (const s of final.students) {
        if (s.passed === null) {
          none += 1;
          continue;
        }
        const value = s.passed ? 'PASSED' : 'FAILED';
        if (s.enrollmentResult && !overwrite) {
          kept += 1;
          continue;
        }
        if (s.enrollmentResult !== value.toLowerCase()) await tx.enrollment.update({ where: { id: s.enrollmentId }, data: { result: value } });
        set += 1;
      }
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.EXAM_FINAL_RESULTS_HANDED_OVER,
        actor: { id: user.id, name: user.name, role: user.role },
        target: { type: 'section', id: section.id, name: final.section.name },
        schoolId: scope.school.id,
        description: `Handed the final results of ${final.section.name} (${year.name}) to Promotion: ${set} set, ${kept} kept, ${none} without a result.`,
        change: { fields: ['result'], set, kept, none, overwrite: Boolean(overwrite) },
        req,
      });
      return { set, kept, none };
    },
    { timeout: 30000, maxWait: 10000 },
  );
}

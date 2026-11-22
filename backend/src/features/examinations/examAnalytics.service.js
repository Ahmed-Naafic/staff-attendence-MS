import { getPrisma } from '../../config/prisma.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { resultsForSection } from './examResults.service.js';
import { findExam } from './examinations.service.js';
import { effectiveExamSettings } from './examSettings.js';

/*
 * Examination analytics (docs/business-rules.md → Examinations → Analytics): how an examination went,
 * from the results as they stand — published results, and (marked provisional) approved or still
 * calculated ones, so a school can follow an examination before publishing it.
 *
 *   basic      students, pass rate, average, failure rate, grade distribution, pass rate and average
 *              by class, by subject.
 *   advanced   (setting "Examination analytics") also: branches compared (school-wide examinations),
 *              the best students, the spread of percents (bands of 10), and each class's subjects.
 * The School Owner sees every branch (or one); a Manager their branch.
 */

const round2 = (n) => Math.round(n * 100) / 100;
const avg = (list) => (list.length ? round2(list.reduce((n, v) => n + v, 0) / list.length) : null);
const rate = (part, whole) => (whole ? round2((part / whole) * 100) : null);

function figures(students) {
  const withResult = students.filter((s) => s.percent !== null);
  const passed = withResult.filter((s) => s.passed).length;
  return {
    students: students.length,
    withResult: withResult.length,
    passed,
    failed: withResult.length - passed,
    passRate: rate(passed, withResult.length),
    failureRate: rate(withResult.length - passed, withResult.length),
    average: avg(withResult.map((s) => s.percent)),
    highest: withResult.length ? Math.max(...withResult.map((s) => s.percent)) : null,
    lowest: withResult.length ? Math.min(...withResult.map((s) => s.percent)) : null,
  };
}

/** Subject figures from students' paper results: [{ subject, sat, average, passRate }]. */
function bySubject(students) {
  const map = new Map();
  for (const s of students) {
    for (const p of s.papers) {
      if (p.percent === null || p.percent === undefined) continue;
      const e = map.get(p.subject) ?? { subject: p.subject, values: [], passed: 0 };
      e.values.push(p.percent);
      if (p.passed) e.passed += 1;
      map.set(p.subject, e);
    }
  }
  return [...map.values()].map((e) => ({ subject: e.subject, sat: e.values.length, average: avg(e.values), passRate: rate(e.passed, e.values.length) })).sort((a, b) => a.subject.localeCompare(b.subject));
}

/** The analytics of an examination: { examination, level, provisional, overall, grades, classes, subjects, branches?, top?, spread? }. */
export async function examAnalytics(scope, examId, { branch }) {
  const prisma = getPrisma();
  const exam = await findExam(prisma, scope, examId);
  const branchId = scope.branch?.id ?? exam.branchId ?? branch ?? null;
  const settings = await effectiveExamSettings(scope.school.id, branchId, prisma);
  const advanced = settings.analyticsLevel === 'advanced';
  const sections = await prisma.section.findMany({
    where: { schoolId: scope.school.id, academicYearId: exam.academicYearId, status: 'ACTIVE', classId: { in: exam.classes.map((c) => c.class.id) }, ...(branchId && { branchId }) },
    select: { id: true, name: true, classId: true, branchId: true, class: { select: { name: true, sequence: true } }, branch: { select: { id: true, name: true } } },
    orderBy: [{ class: { sequence: 'asc' } }, { nameKey: 'asc' }],
  });
  const all = [];
  const classes = [];
  let provisional = false;
  for (const s of sections) {
    const r = await resultsForSection(prisma, exam, s);
    if (r.provisional) provisional = true;
    const name = sectionDisplayName(s.class.name, s.name);
    all.push(...r.students.map((x) => ({ ...x, section: { id: s.id, name }, branch: s.branch })));
    classes.push({ section: { id: s.id, name, branch: s.branch }, status: r.status, ...figures(r.students), ...(advanced && { subjects: bySubject(r.students) }) });
  }
  const grades = {};
  for (const s of all) if (s.grade) grades[s.grade] = (grades[s.grade] ?? 0) + 1;
  const withResult = all.filter((s) => s.percent !== null);
  const result = {
    examination: { id: exam.id, name: exam.name, level: exam.branchId ? 'branch' : 'school' },
    level: advanced ? 'advanced' : 'basic',
    provisional,
    overall: figures(all),
    grades: Object.entries(grades)
      .map(([grade, count]) => ({ grade, count, percent: rate(count, withResult.length) }))
      .sort((a, b) => a.grade.localeCompare(b.grade)),
    classes,
    subjects: bySubject(all),
  };
  if (advanced) {
    const branches = new Map();
    for (const s of all) branches.set(s.branch.id, [...(branches.get(s.branch.id) ?? []), s]);
    result.branches = [...branches.values()].map((list) => ({ branch: list[0].branch, ...figures(list) })).sort((a, b) => a.branch.name.localeCompare(b.branch.name));
    result.top = [...withResult]
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 10)
      .map((s) => ({ student: s.student, section: s.section, percent: s.percent, grade: s.grade }));
    result.spread = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9.99, count: withResult.filter((s) => (i === 9 ? s.percent >= 90 : s.percent >= i * 10 && s.percent < (i + 1) * 10)).length }));
  }
  return result;
}

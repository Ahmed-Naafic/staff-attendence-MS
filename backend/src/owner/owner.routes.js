import { Router } from 'express';
import { readListQuery } from '../common/listQuery.js';
import { badRequest } from '../common/httpError.js';
import { isUuid, jsonBody, optionalDay, optionalInt, optionalString } from '../common/validate.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireOwnerSchool } from '../middleware/requireOwnerSchool.js';
import { readCurriculum, readSubjectCreation, readSubjectListQuery, readSubjectUpdate } from '../features/subjects/subjectInput.js';
import { createSubject, deactivateSubject, getCurriculum, getSubject, listSubjects, reactivateSubject, setCurriculum, updateSubject } from '../features/subjects/subjects.service.js';
import { readAssignment, readAssignmentEnd, readAssignmentQuery, readTeacherQuery } from '../features/teaching/teachingInput.js';
import { mountTimetableRoutes } from '../features/timetable/timetable.routes.js';
import { mountTimetableBuilderRoutes } from '../features/timetable-builder/builder.routes.js';
import { mountStudentAttendanceRoutes } from '../features/student-attendance/studentAttendance.routes.js';
import { assignTeaching, cancelAssignment, eligibleTeachers, listTeachingAssignments, sectionTeaching, setAssignmentEnd } from '../features/teaching/teaching.service.js';
import { readEntryCreation, readEntryUpdate, readSchoolDaysQuery, readWeekdayPolicy, readWeekdaysChange } from '../features/academic-calendar/calendarInput.js';
import {
  calendarToday,
  cancelEntry,
  cancelWeekdays,
  createEntry,
  getCalendar,
  listSchoolDays,
  saveWeekdays,
  setBranchWeekdaysAllowed,
  updateEntry,
} from '../features/academic-calendar/calendar.service.js';
import { readTransfer } from '../features/staff/staffInput.js';
import { STAFF_STATUSES } from '../features/staff/staff.service.js';
import { branchShiftsOn, cancelTransfer, getSchoolStaff, listSchoolStaff, scheduleTransfer } from '../features/staff/transfers.service.js';
import { readBranchCreation, readBranchSuspension, readBranchUpdate, readLocationChange } from '../features/branches/branchInput.js';
import {
  BRANCH_STATUSES,
  cancelScheduledLocation,
  changeLocation,
  createBranch,
  getBranch,
  listBranchAudit,
  listBranches,
  listLocations,
  reactivateBranch,
  suspendBranch,
  toOwnerSchool,
  updateBranch,
} from '../features/branches/branches.service.js';
import {
  readManagerCreation,
  readManagerSuspension,
  readManagerTransfer,
  readManagerUpdate,
  readTemporaryPassword,
} from '../features/managers/managerInput.js';
import {
  createManager,
  getManager,
  listManagerAudit,
  listManagers,
  MANAGER_STATUSES,
  reactivateManager,
  resetManagerPassword,
  suspendManager,
  transferManager,
  updateManager,
} from '../features/managers/managers.service.js';
import { attendanceOptions, attendanceRecords, attendanceSummary, reportToday } from '../features/attendance/attendanceReports.service.js';
import { previewExport, sendCsvExport, sendPdfExport, sendXlsxExport } from '../features/attendance/attendanceExport.js';
import { readExportQuery, readOptionsQuery, readRecordsQuery, readSummaryQuery } from '../features/attendance/reportInput.js';
import {
  readClassCreation,
  readClassListQuery,
  readClassUpdate,
  readSectionCreation,
  readSectionListQuery,
  readSectionUpdate,
} from '../features/classes/classInput.js';
import {
  createClass,
  createSection,
  deactivateClass,
  deactivateSection,
  getClass,
  getSection,
  listClasses,
  listSections,
  reactivateClass,
  reactivateSection,
  updateClass,
  updateSection,
} from '../features/classes/classes.service.js';
import { readStudentListQuery, readStudentRegistration, readStudentUpdate } from '../features/students/studentInput.js';
import { getStudent, listStudents, registerStudent, updateStudent } from '../features/students/students.service.js';
import { getPromotion, listPromotions } from '../features/students/promotions.service.js';
import { readAcademicYearCreation, readAcademicYearStart, readAcademicYearUpdate } from '../features/academic-years/academicYearInput.js';
import {
  applyAcademicYearFilter,
  closeAcademicYear,
  createAcademicYear,
  deleteAcademicYear,
  getAcademicYear,
  listAcademicYearAudit,
  listAcademicYears,
  startAcademicYear,
  updateAcademicYear,
} from '../features/academic-years/academicYears.service.js';

/**
 * School Owner API (/api/owner). Every route requires a signed-in OWNER with a linked school;
 * req.school is that school, found from the account (requireOwnerSchool), and every query is
 * limited to it. Branch Management and Manager accounts (docs/business-rules.md): no deletion,
 * no transfer between schools, no Super Admin access. Writes are refused while the school is
 * suspended.
 */
export const ownerRouter = Router();
ownerRouter.use(requireAuth, requireRole('OWNER'), requireOwnerSchool);

ownerRouter.get('/school', (req, res) => {
  res.json({ school: toOwnerSchool(req.school) });
});

ownerRouter.get('/branches', async (req, res) => {
  const { q, status, page, pageSize } = readListQuery(req.query, { statuses: BRANCH_STATUSES, defaultPageSize: 8 });
  res.json(await listBranches(req.school, { q, status, page, pageSize }));
});
ownerRouter.get('/branches/:id', async (req, res) => {
  res.json({ branch: await getBranch(req.school, req.params.id) });
});
ownerRouter.post('/branches', async (req, res) => {
  res.status(201).json({ branch: await createBranch(req.school, readBranchCreation(jsonBody(req)), req.user, req) });
});
ownerRouter.patch('/branches/:id', async (req, res) => {
  res.json({ branch: await updateBranch(req.school, req.params.id, readBranchUpdate(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/branches/:id/suspend', async (req, res) => {
  res.json({ branch: await suspendBranch(req.school, req.params.id, readBranchSuspension(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/branches/:id/reactivate', async (req, res) => {
  res.json({ branch: await reactivateBranch(req.school, req.params.id, req.user, req) });
});

ownerRouter.get('/branches/:id/locations', async (req, res) => {
  res.json(await listLocations(req.school, req.params.id));
});
// Effective time judged by the server clock: now, or later (no backdating); replaces a scheduled change.
ownerRouter.post('/branches/:id/locations', async (req, res) => {
  res.json({ branch: await changeLocation(req.school, req.params.id, readLocationChange(jsonBody(req), new Date()), req.user, req) });
});
ownerRouter.delete('/branches/:id/locations/scheduled', async (req, res) => {
  res.json({ branch: await cancelScheduledLocation(req.school, req.params.id, req.user, req) });
});

// ---- Manager accounts ----
const optionalId = (query, name) => {
  const value = optionalString(query, name, { max: 64 });
  if (value !== undefined && !isUuid(value)) throw badRequest(`"${name}" must be an id.`);
  return value;
};

ownerRouter.get('/managers', async (req, res) => {
  const { q, status, page, pageSize } = readListQuery(req.query, { statuses: MANAGER_STATUSES, defaultPageSize: 8 });
  res.json(await listManagers(req.school, { q, status, branch: optionalId(req.query, 'branch'), page, pageSize }));
});
ownerRouter.get('/managers/:id', async (req, res) => {
  res.json({ manager: await getManager(req.school, req.params.id) });
});
ownerRouter.post('/managers', async (req, res) => {
  res.status(201).json({ manager: await createManager(req.school, readManagerCreation(jsonBody(req)), req.user, req) });
});
ownerRouter.patch('/managers/:id', async (req, res) => {
  res.json({ manager: await updateManager(req.school, req.params.id, readManagerUpdate(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/managers/:id/transfer', async (req, res) => {
  res.json({ manager: await transferManager(req.school, req.params.id, readManagerTransfer(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/managers/:id/suspend', async (req, res) => {
  res.json({ manager: await suspendManager(req.school, req.params.id, readManagerSuspension(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/managers/:id/reactivate', async (req, res) => {
  res.json({ manager: await reactivateManager(req.school, req.params.id, req.user, req) });
});
ownerRouter.post('/managers/:id/password', async (req, res) => {
  res.json({ manager: await resetManagerPassword(req.school, req.params.id, readTemporaryPassword(jsonBody(req)), req.user, req) });
});

// ---- Academic years (school level; docs/business-rules.md → Academic years) ----
// The body of start is optional: { closeCurrent: true } confirms closing the current year.
const optionalJsonBody = (req) => (req.body === undefined ? {} : jsonBody(req));

ownerRouter.get('/academic-years', async (req, res) => {
  res.json(await listAcademicYears(req.school));
});
ownerRouter.get('/academic-years/audit-logs', async (req, res) => {
  const page = optionalInt(req.query, 'page', { min: 1, max: 100000, fallback: 1 });
  const pageSize = optionalInt(req.query, 'pageSize', { min: 1, max: 100, fallback: 10 });
  res.json(await listAcademicYearAudit(req.school, { year: optionalId(req.query, 'year'), page, pageSize }));
});
ownerRouter.get('/academic-years/:id', async (req, res) => {
  res.json({ academicYear: await getAcademicYear(req.school, req.params.id) });
});
ownerRouter.post('/academic-years', async (req, res) => {
  res.status(201).json({ academicYear: await createAcademicYear(req.school, readAcademicYearCreation(jsonBody(req)), req.user, req) });
});
ownerRouter.patch('/academic-years/:id', async (req, res) => {
  res.json({ academicYear: await updateAcademicYear(req.school, req.params.id, readAcademicYearUpdate(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/academic-years/:id/start', async (req, res) => {
  res.json(await startAcademicYear(req.school, req.params.id, readAcademicYearStart(optionalJsonBody(req)), req.user, req));
});
ownerRouter.post('/academic-years/:id/close', async (req, res) => {
  res.json({ academicYear: await closeAcademicYear(req.school, req.params.id, req.user, req) });
});
ownerRouter.delete('/academic-years/:id', async (req, res) => {
  await deleteAcademicYear(req.school, req.params.id, req.user, req);
  res.status(204).end();
});

// ---- Academic calendar (docs/business-rules.md → Academic calendar): weekly school days and the
// calendar's holidays, closures and reopenings. The School Owner sets the school's days, holidays, and closures and reopenings of any branch.
const calendarScope = (req) => ({ school: req.school, branch: null });

ownerRouter.get('/academic-years/:id/calendar', async (req, res) => {
  res.json(await getCalendar(calendarScope(req), req.params.id));
});
ownerRouter.put('/academic-years/:id/weekdays', async (req, res) => {
  res.json(await saveWeekdays(calendarScope(req), req.params.id, readWeekdaysChange(jsonBody(req), { role: 'OWNER' }), req.user, req));
});
ownerRouter.post('/academic-years/:id/weekdays/:versionId/cancel', async (req, res) => {
  res.json(await cancelWeekdays(calendarScope(req), req.params.id, req.params.versionId, req.user, req));
});
ownerRouter.put('/academic-years/:id/weekday-policy', async (req, res) => {
  res.json(await setBranchWeekdaysAllowed(req.school, req.params.id, readWeekdayPolicy(jsonBody(req)), req.user, req));
});
ownerRouter.post('/academic-years/:id/calendar-entries', async (req, res) => {
  res.status(201).json({ entry: await createEntry(calendarScope(req), req.params.id, readEntryCreation(jsonBody(req), { role: 'OWNER' }), req.user, req) });
});
ownerRouter.patch('/calendar-entries/:id', async (req, res) => {
  res.json({ entry: await updateEntry(calendarScope(req), req.params.id, readEntryUpdate(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/calendar-entries/:id/cancel', async (req, res) => {
  res.json({ entry: await cancelEntry(calendarScope(req), req.params.id, req.user, req) });
});
// Whether a branch has school on each day from..to (at most 366 days); branch is required.
ownerRouter.get('/calendar/days', async (req, res) => {
  res.json(await listSchoolDays(calendarScope(req), readSchoolDaysQuery(req.query, { role: 'OWNER', today: await calendarToday() })));
});

// ---- Subjects and class curricula (School Owner manages; Managers read) and teaching
// assignments (docs/business-rules.md → Subjects; Teaching assignments).
const teachingScope = (req) => ({ school: req.school, branch: null });

ownerRouter.get('/subjects', async (req, res) => {
  res.json(await listSubjects(req.school, readSubjectListQuery(req.query)));
});
ownerRouter.get('/subjects/:id', async (req, res) => {
  res.json({ subject: await getSubject(req.school, req.params.id) });
});
ownerRouter.post('/subjects', async (req, res) => {
  res.status(201).json({ subject: await createSubject(req.school, readSubjectCreation(jsonBody(req)), req.user, req) });
});
ownerRouter.patch('/subjects/:id', async (req, res) => {
  res.json({ subject: await updateSubject(req.school, req.params.id, readSubjectUpdate(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/subjects/:id/deactivate', async (req, res) => {
  res.json({ subject: await deactivateSubject(req.school, req.params.id, req.user, req) });
});
ownerRouter.post('/subjects/:id/reactivate', async (req, res) => {
  res.json({ subject: await reactivateSubject(req.school, req.params.id, req.user, req) });
});
ownerRouter.put('/classes/:id/subjects', async (req, res) => {
  res.json(await setCurriculum(req.school, req.params.id, readCurriculum(jsonBody(req)), req.user, req));
});
ownerRouter.get('/classes/:id/subjects', async (req, res) => {
  res.json(await getCurriculum(req.school, req.params.id));
});
ownerRouter.get('/teaching-assignments', async (req, res) => {
  res.json(await listTeachingAssignments(teachingScope(req), readAssignmentQuery(req.query, { role: 'OWNER' })));
});
ownerRouter.post('/teaching-assignments', async (req, res) => {
  res.status(201).json({ assignment: await assignTeaching(teachingScope(req), readAssignment(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/teaching-assignments/:id/end', async (req, res) => {
  res.json({ assignment: await setAssignmentEnd(teachingScope(req), req.params.id, readAssignmentEnd(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/teaching-assignments/:id/cancel', async (req, res) => {
  res.json({ assignment: await cancelAssignment(teachingScope(req), req.params.id, req.user, req) });
});
ownerRouter.get('/sections/:id/teaching', async (req, res) => {
  res.json(await sectionTeaching(teachingScope(req), req.params.id));
});
// Staff who can be given teaching (any active staff of the school), suggested teachers first.
ownerRouter.get('/teaching/teachers', async (req, res) => {
  res.json(await eligibleTeachers(teachingScope(req), { ...readTeacherQuery(req.query), academicYear: typeof req.query.academicYear === 'string' && req.query.academicYear ? req.query.academicYear : 'current' }));
});

// ---- Bell schedules and section timetables (docs/business-rules.md → Bell schedules; Timetables).
mountTimetableRoutes(ownerRouter, teachingScope, 'OWNER');
// Timetable builder (setup, readiness, generate, review, publish) and the class / teacher / master views.
mountTimetableBuilderRoutes(ownerRouter, teachingScope, 'OWNER');

// ---- Student attendance (docs/business-rules.md → Student attendance): the school's settings and
// what branches may change; every branch's attendance and excuses (read only).
mountStudentAttendanceRoutes(ownerRouter, teachingScope, 'OWNER');

// ---- Classes (School Owner) and sections of every branch of the school ----
const classScope = (req) => ({ school: req.school, branch: null });

ownerRouter.get('/classes', async (req, res) => {
  res.json(await listClasses(classScope(req), readClassListQuery(req.query, { role: 'OWNER' })));
});
ownerRouter.get('/classes/:id', async (req, res) => {
  res.json(await getClass(classScope(req), req.params.id, readClassListQuery(req.query, { role: 'OWNER' })));
});
ownerRouter.post('/classes', async (req, res) => {
  res.status(201).json({ class: await createClass(classScope(req), readClassCreation(jsonBody(req)), req.user, req) });
});
ownerRouter.patch('/classes/:id', async (req, res) => {
  res.json({ class: await updateClass(classScope(req), req.params.id, readClassUpdate(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/classes/:id/deactivate', async (req, res) => {
  res.json({ class: await deactivateClass(classScope(req), req.params.id, req.user, req) });
});
ownerRouter.post('/classes/:id/reactivate', async (req, res) => {
  res.json({ class: await reactivateClass(classScope(req), req.params.id, req.user, req) });
});

ownerRouter.get('/sections', async (req, res) => {
  res.json(await listSections(classScope(req), readSectionListQuery(req.query, { role: 'OWNER' })));
});
ownerRouter.get('/sections/:id', async (req, res) => {
  res.json({ section: await getSection(classScope(req), req.params.id) });
});
ownerRouter.post('/sections', async (req, res) => {
  res.status(201).json({ section: await createSection(classScope(req), readSectionCreation(jsonBody(req), { role: 'OWNER' }), req.user, req) });
});
ownerRouter.patch('/sections/:id', async (req, res) => {
  res.json({ section: await updateSection(classScope(req), req.params.id, readSectionUpdate(jsonBody(req)), req.user, req) });
});
ownerRouter.post('/sections/:id/deactivate', async (req, res) => {
  res.json({ section: await deactivateSection(classScope(req), req.params.id, req.user, req) });
});
ownerRouter.post('/sections/:id/reactivate', async (req, res) => {
  res.json({ section: await reactivateSection(classScope(req), req.params.id, req.user, req) });
});

// ---- Students of every branch of the school (profiles; enrollment and promotion are the Managers') ----
const studentScope = (req) => ({ school: req.school, branch: null });

ownerRouter.get('/students', async (req, res) => {
  res.json(await listStudents(studentScope(req), readStudentListQuery(req.query, { role: 'OWNER' })));
});
ownerRouter.get('/students/:id', async (req, res) => {
  res.json({ student: await getStudent(studentScope(req), req.params.id) });
});
ownerRouter.post('/students', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.status(201).json({ student: await registerStudent(studentScope(req), readStudentRegistration(jsonBody(req), { role: 'OWNER', today }), req.user, req) });
});
ownerRouter.patch('/students/:id', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({ student: await updateStudent(studentScope(req), req.params.id, readStudentUpdate(jsonBody(req), { today }), req.user, req) });
});
// Promotions of every branch (read only).
ownerRouter.get('/promotions', async (req, res) => {
  res.json(await listPromotions(studentScope(req)));
});
ownerRouter.get('/promotions/:id', async (req, res) => {
  res.json(await getPromotion(studentScope(req), req.params.id));
});

// ---- Staff transfers between the school's branches (T1: School Owner only) ----
// The staff list here is for transfers: name, Staff ID, job title, status, branch; no contact data.
ownerRouter.get('/staff', async (req, res) => {
  const { q, status, page, pageSize } = readListQuery(req.query, { statuses: STAFF_STATUSES, defaultPageSize: 10 });
  res.json(await listSchoolStaff(req.school, { q, status, page, pageSize, branch: optionalId(req.query, 'branch') }));
});
ownerRouter.get('/staff/:id', async (req, res) => {
  res.json({ staff: await getSchoolStaff(req.school, req.params.id) });
});
ownerRouter.post('/staff/:id/transfer', async (req, res) => {
  res.status(201).json({ transfer: await scheduleTransfer(req.school, req.params.id, readTransfer(jsonBody(req)), req.user, req) });
});
ownerRouter.delete('/staff/:id/transfer/scheduled', async (req, res) => {
  res.json({ staff: await cancelTransfer(req.school, req.params.id, req.user, req) });
});
// The shifts of a branch's schedule in effect on a date (to choose the destination shifts of a transfer).
ownerRouter.get('/branches/:id/shifts', async (req, res) => {
  const date = optionalDay(req.query, 'date');
  if (!date) throw badRequest('"date" is required (YYYY-MM-DD).');
  res.json(await branchShiftsOn(req.school, req.params.id, date));
});

// Branch audit events of this school only, or (with `manager`) one Manager's events.
ownerRouter.get('/audit-logs', async (req, res) => {
  const branch = optionalId(req.query, 'branch');
  const manager = optionalId(req.query, 'manager');
  if (branch && manager) throw badRequest('Use "branch" or "manager", not both.');
  const page = optionalInt(req.query, 'page', { min: 1, max: 100000, fallback: 1 });
  const pageSize = optionalInt(req.query, 'pageSize', { min: 1, max: 100, fallback: 10 });
  res.json(manager ? await listManagerAudit(req.school, { manager, page, pageSize }) : await listBranchAudit(req.school, { branch, page, pageSize }));
});

// ---- Attendance reports (read only; docs/reports/): every branch of the owner's school, or one ----
// The school is req.school (from the account); a branch or staff member of another school is not found.
const ownerScope = (req) => ({ schoolId: req.school.id });

/** A report query with the optional academic year filter applied (dates inside the year; see applyAcademicYearFilter). */
async function reportQuery(req, read, today) {
  const { query, academicYear } = await applyAcademicYearFilter(req.query, req.school.id, today);
  const filters = read(query, { role: 'OWNER', today });
  return academicYear ? { ...filters, academicYear: academicYear.name } : filters;
}

ownerRouter.get('/attendance/summary', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceSummary(ownerScope(req), await reportQuery(req, readSummaryQuery, today), { compareBranches: true, today }));
});
ownerRouter.get('/attendance/records', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceRecords(ownerScope(req), await reportQuery(req, readRecordsQuery, today), { withBranch: true, today }));
});
ownerRouter.get('/attendance/options', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceOptions(ownerScope(req), await reportQuery(req, readOptionsQuery, today), { listBranches: true, today }));
});
// Exports of every record matching the filters (at most 10,000 rows, refused rather than truncated): CSV (data only), Excel and PDF.
ownerRouter.get('/attendance/export.csv', async (req, res) => {
  const today = await reportToday();
  await sendCsvExport(res, 'OWNER', ownerScope(req), await reportQuery(req, readExportQuery, today));
});
ownerRouter.get('/attendance/export.xlsx', async (req, res) => {
  const today = await reportToday();
  await sendXlsxExport(res, 'OWNER', ownerScope(req), await reportQuery(req, readExportQuery, today));
});
ownerRouter.get('/attendance/export.pdf', async (req, res) => {
  const today = await reportToday();
  await sendPdfExport(res, 'OWNER', ownerScope(req), await reportQuery(req, readExportQuery, today));
});
// Preview of an export (JSON): heading, summary and total of every matching row, and the first 50 rows
// as the files write them. Not the download's data: each download reads and checks everything again.
ownerRouter.get('/attendance/export/preview', async (req, res) => {
  const today = await reportToday();
  res.json(await previewExport('OWNER', ownerScope(req), await reportQuery(req, readExportQuery, today)));
});

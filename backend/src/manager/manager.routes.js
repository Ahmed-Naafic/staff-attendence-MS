import { Router } from 'express';
import { fromDbStatus } from '../common/listQuery.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireManagerBranch } from '../middleware/requireManagerBranch.js';
import { readCurriculum, readSubjectCreation, readSubjectListQuery, readSubjectUpdate } from '../features/subjects/subjectInput.js';
import { createSubject, deactivateSubject, getCurriculum, getSubject, listSubjects, reactivateSubject, setCurriculum, updateSubject } from '../features/subjects/subjects.service.js';
import { readAssignment, readAssignmentEnd, readAssignmentQuery, readTeacherQuery } from '../features/teaching/teachingInput.js';
import { mountTimetableRoutes } from '../features/timetable/timetable.routes.js';
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
import { readListQuery } from '../common/listQuery.js';
import { jsonBody } from '../common/validate.js';
import { attendanceOptions, attendanceRecords, attendanceSummary, reportToday } from '../features/attendance/attendanceReports.service.js';
import { previewExport, sendCsvExport, sendPdfExport, sendXlsxExport } from '../features/attendance/attendanceExport.js';
import { readExportQuery, readOptionsQuery, readRecordsQuery, readSummaryQuery } from '../features/attendance/reportInput.js';
import { operatingState } from '../features/branches/branches.service.js';
import { applyAcademicYearFilter, listAcademicYears } from '../features/academic-years/academicYears.service.js';
import {
  readEnrollment,
  readEnrollmentUpdate,
  readPromotionChanges,
  readPromotionConfirm,
  readPromotionStart,
  readStudentListQuery,
  readStudentRegistration,
  readStudentUpdate,
  readTransferOut,
} from '../features/students/studentInput.js';
import { enrollStudent, getStudent, listStudents, registerStudent, transferOutStudent, updateEnrollment, updateStudent } from '../features/students/students.service.js';
import {
  confirmPromotion,
  getPromotion,
  listPromotions,
  processPromotion,
  refreshPromotion,
  retryPromotion,
  startPromotion,
  updatePromotionItems,
} from '../features/students/promotions.service.js';
import { readClassListQuery, readSectionCreation, readSectionListQuery, readSectionUpdate } from '../features/classes/classInput.js';
import {
  createSection,
  deactivateSection,
  getClass,
  getSection,
  listClasses,
  listSections,
  reactivateSection,
  updateSection,
} from '../features/classes/classes.service.js';
import { readScheduleChange } from '../features/schedules/scheduleInput.js';
import { getBranchReminderSettings, updateBranchReminderSettings } from '../features/notifications/notificationSettings.service.js';
import { cancelScheduledSchedule, getSchedule, listVersions, saveSchedule } from '../features/schedules/schedules.service.js';
import { readAssignmentChange, readStaffCreation, readStaffPassword, readStaffSuspension, readStaffUpdate } from '../features/staff/staffInput.js';
import {
  cancelScheduledAssignments,
  createStaff,
  getStaff,
  listAssignments,
  listStaff,
  reactivateStaff,
  resetStaffPassword,
  saveAssignments,
  STAFF_STATUSES,
  suspendStaff,
  updateStaff,
} from '../features/staff/staff.service.js';

/**
 * Manager API (/api/manager). Every route requires a signed-in MANAGER who has replaced their
 * temporary password (requireAuth) and works on req.branch, the Manager's own branch, read from
 * the database on every request (requireManagerBranch). A Manager reads their branch and manages its
 * schedule and staff (docs/business-rules.md → Branch schedules and shifts; Staff accounts and shift
 * assignments), and reads its attendance reports (docs/reports/).
 */
export const managerRouter = Router();
managerRouter.use(requireAuth, requireRole('MANAGER'), requireManagerBranch);

managerRouter.get('/branch', (req, res) => {
  const { school, ...branch } = req.branch;
  const { operating, reasons } = operatingState(branch, school);
  res.json({
    branch: { ...branch, phone: branch.phone ?? '', status: fromDbStatus(branch.status), operating, notOperatingReasons: reasons },
    school: { id: school.id, code: school.code, name: school.name, status: fromDbStatus(school.status) },
  });
});

// ---- Academic years of the Manager's school (read only; the School Owner manages them) ----
managerRouter.get('/academic-years', async (req, res) => {
  res.json(await listAcademicYears(req.branch.school));
});

// ---- Academic calendar (docs/business-rules.md → Academic calendar): weekly school days and the
// calendar's holidays, closures and reopenings. A Manager reads the school calendar and manages their own branch's school days (when the year allows it), closures and reopenings.
const calendarScope = (req) => {
  const { school, ...branch } = req.branch;
  return { school, branch };
};

managerRouter.get('/academic-years/:id/calendar', async (req, res) => {
  res.json(await getCalendar(calendarScope(req), req.params.id));
});
managerRouter.put('/academic-years/:id/weekdays', async (req, res) => {
  res.json(await saveWeekdays(calendarScope(req), req.params.id, readWeekdaysChange(jsonBody(req), { role: 'MANAGER' }), req.user, req));
});
managerRouter.post('/academic-years/:id/weekdays/:versionId/cancel', async (req, res) => {
  res.json(await cancelWeekdays(calendarScope(req), req.params.id, req.params.versionId, req.user, req));
});
managerRouter.post('/academic-years/:id/calendar-entries', async (req, res) => {
  res.status(201).json({ entry: await createEntry(calendarScope(req), req.params.id, readEntryCreation(jsonBody(req), { role: 'MANAGER' }), req.user, req) });
});
managerRouter.patch('/calendar-entries/:id', async (req, res) => {
  res.json({ entry: await updateEntry(calendarScope(req), req.params.id, readEntryUpdate(jsonBody(req)), req.user, req) });
});
managerRouter.post('/calendar-entries/:id/cancel', async (req, res) => {
  res.json({ entry: await cancelEntry(calendarScope(req), req.params.id, req.user, req) });
});
// Whether the branch has school on each day from..to (at most 366 days).
managerRouter.get('/calendar/days', async (req, res) => {
  res.json(await listSchoolDays(calendarScope(req), readSchoolDaysQuery(req.query, { role: 'MANAGER', today: await calendarToday() })));
});

// ---- Subjects and class curricula (School Owner manages; Managers read) and teaching
// assignments (docs/business-rules.md → Subjects; Teaching assignments).
const teachingScope = calendarScope;

managerRouter.get('/subjects', async (req, res) => {
  res.json(await listSubjects(req.branch.school, readSubjectListQuery(req.query)));
});
managerRouter.get('/subjects/:id', async (req, res) => {
  res.json({ subject: await getSubject(req.branch.school, req.params.id) });
});
managerRouter.get('/classes/:id/subjects', async (req, res) => {
  res.json(await getCurriculum(req.branch.school, req.params.id));
});
managerRouter.get('/teaching-assignments', async (req, res) => {
  res.json(await listTeachingAssignments(teachingScope(req), readAssignmentQuery(req.query, { role: 'MANAGER' })));
});
managerRouter.post('/teaching-assignments', async (req, res) => {
  res.status(201).json({ assignment: await assignTeaching(teachingScope(req), readAssignment(jsonBody(req)), req.user, req) });
});
managerRouter.post('/teaching-assignments/:id/end', async (req, res) => {
  res.json({ assignment: await setAssignmentEnd(teachingScope(req), req.params.id, readAssignmentEnd(jsonBody(req)), req.user, req) });
});
managerRouter.post('/teaching-assignments/:id/cancel', async (req, res) => {
  res.json({ assignment: await cancelAssignment(teachingScope(req), req.params.id, req.user, req) });
});
managerRouter.get('/sections/:id/teaching', async (req, res) => {
  res.json(await sectionTeaching(teachingScope(req), req.params.id));
});
// Staff who can be given teaching (active staff of the branch), suggested teachers first.
managerRouter.get('/teaching/teachers', async (req, res) => {
  res.json(await eligibleTeachers(teachingScope(req), { ...readTeacherQuery(req.query), academicYear: typeof req.query.academicYear === 'string' && req.query.academicYear ? req.query.academicYear : 'current' }));
});

// ---- Bell schedules and section timetables (docs/business-rules.md → Bell schedules; Timetables).
mountTimetableRoutes(managerRouter, teachingScope, 'MANAGER');

// ---- Student attendance (docs/business-rules.md → Student attendance): settings, half-day sessions,
// marks and excuses of the Manager's branch.
mountStudentAttendanceRoutes(managerRouter, teachingScope, 'MANAGER');

// ---- Classes (read only; the School Owner manages them) and the sections of the Manager's branch ----
const classScope = (req) => {
  const { school, ...branch } = req.branch;
  return { school, branch };
};

managerRouter.get('/classes', async (req, res) => {
  res.json(await listClasses(classScope(req), readClassListQuery(req.query, { role: 'MANAGER' })));
});
managerRouter.get('/classes/:id', async (req, res) => {
  res.json(await getClass(classScope(req), req.params.id, readClassListQuery(req.query, { role: 'MANAGER' })));
});
managerRouter.get('/sections', async (req, res) => {
  res.json(await listSections(classScope(req), readSectionListQuery(req.query, { role: 'MANAGER' })));
});
managerRouter.get('/sections/:id', async (req, res) => {
  res.json({ section: await getSection(classScope(req), req.params.id) });
});
managerRouter.post('/sections', async (req, res) => {
  res.status(201).json({ section: await createSection(classScope(req), readSectionCreation(jsonBody(req), { role: 'MANAGER' }), req.user, req) });
});
managerRouter.patch('/sections/:id', async (req, res) => {
  res.json({ section: await updateSection(classScope(req), req.params.id, readSectionUpdate(jsonBody(req)), req.user, req) });
});
managerRouter.post('/sections/:id/deactivate', async (req, res) => {
  res.json({ section: await deactivateSection(classScope(req), req.params.id, req.user, req) });
});
managerRouter.post('/sections/:id/reactivate', async (req, res) => {
  res.json({ section: await reactivateSection(classScope(req), req.params.id, req.user, req) });
});

// ---- Students of the Manager's branch: registration, enrollment, transfer out ----
const todayDay = () => new Date().toISOString().slice(0, 10);

managerRouter.get('/students', async (req, res) => {
  res.json(await listStudents(classScope(req), readStudentListQuery(req.query, { role: 'MANAGER' })));
});
managerRouter.get('/students/:id', async (req, res) => {
  res.json({ student: await getStudent(classScope(req), req.params.id) });
});
managerRouter.post('/students', async (req, res) => {
  res.status(201).json({ student: await registerStudent(classScope(req), readStudentRegistration(jsonBody(req), { role: 'MANAGER', today: todayDay() }), req.user, req) });
});
managerRouter.patch('/students/:id', async (req, res) => {
  res.json({ student: await updateStudent(classScope(req), req.params.id, readStudentUpdate(jsonBody(req), { today: todayDay() }), req.user, req) });
});
managerRouter.post('/students/:id/enrollments', async (req, res) => {
  res.status(201).json({ enrollment: await enrollStudent(classScope(req), req.params.id, readEnrollment(jsonBody(req)), req.user, req) });
});
managerRouter.post('/students/:id/transfer-out', async (req, res) => {
  res.json({ student: await transferOutStudent(classScope(req), req.params.id, readTransferOut(jsonBody(req)), req.user, req) });
});
managerRouter.patch('/enrollments/:id', async (req, res) => {
  res.json({ enrollment: await updateEnrollment(classScope(req), req.params.id, readEnrollmentUpdate(jsonBody(req)), req.user, req) });
});

// ---- Bulk Academic Year Enrollment & Promotion (the Manager's branch) ----
managerRouter.get('/promotions', async (req, res) => {
  res.json(await listPromotions(classScope(req)));
});
managerRouter.post('/promotions', async (req, res) => {
  res.json(await startPromotion(classScope(req), readPromotionStart(jsonBody(req)), req.user, req));
});
managerRouter.get('/promotions/:id', async (req, res) => {
  res.json(await getPromotion(classScope(req), req.params.id));
});
managerRouter.post('/promotions/:id/refresh', async (req, res) => {
  res.json(await refreshPromotion(classScope(req), req.params.id));
});
managerRouter.patch('/promotions/:id/items', async (req, res) => {
  res.json(await updatePromotionItems(classScope(req), req.params.id, readPromotionChanges(jsonBody(req))));
});
managerRouter.post('/promotions/:id/confirm', async (req, res) => {
  readPromotionConfirm(jsonBody(req));
  res.json(await confirmPromotion(classScope(req), req.params.id, req.user, req));
});
// Processes for a limited time per call and reports progress; the web app calls again until nothing is waiting.
managerRouter.post('/promotions/:id/process', async (req, res) => {
  res.json(await processPromotion(classScope(req), req.params.id, req.user, req));
});
managerRouter.post('/promotions/:id/retry', async (req, res) => {
  res.json(await retryPromotion(classScope(req), req.params.id));
});

// ---- Schedule (read only while the branch or school is suspended: 409 BRANCH_NOT_OPERATING) ----
managerRouter.get('/schedule', async (req, res) => {
  res.json(await getSchedule(req.branch));
});
managerRouter.get('/schedule/versions', async (req, res) => {
  res.json(await listVersions(req.branch));
});
managerRouter.post('/schedule', async (req, res) => {
  res.json(await saveSchedule(req.branch, readScheduleChange(jsonBody(req)), req.user, req));
});
managerRouter.delete('/schedule/scheduled', async (req, res) => {
  res.json(await cancelScheduledSchedule(req.branch, req.user, req));
});

// ---- Reminder settings for the branch's staff (within the platform limits, N5) ----
managerRouter.get('/notification-settings', async (req, res) => {
  res.json(await getBranchReminderSettings(req.branch));
});
managerRouter.put('/notification-settings', async (req, res) => {
  res.json(await updateBranchReminderSettings(req.branch, jsonBody(req), req.user, req));
});

// ---- Staff of the Manager's branch (read only while the branch or school is suspended) ----
managerRouter.get('/staff', async (req, res) => {
  const { q, status, page, pageSize } = readListQuery(req.query, { statuses: STAFF_STATUSES, defaultPageSize: 8 });
  res.json(await listStaff(req.branch, { q, status, page, pageSize }));
});
managerRouter.get('/staff/:id', async (req, res) => {
  res.json({ staff: await getStaff(req.branch, req.params.id) });
});
managerRouter.post('/staff', async (req, res) => {
  res.status(201).json({ staff: await createStaff(req.branch, readStaffCreation(jsonBody(req)), req.user, req) });
});
managerRouter.patch('/staff/:id', async (req, res) => {
  res.json({ staff: await updateStaff(req.branch, req.params.id, readStaffUpdate(jsonBody(req)), req.user, req) });
});
managerRouter.post('/staff/:id/suspend', async (req, res) => {
  res.json({ staff: await suspendStaff(req.branch, req.params.id, readStaffSuspension(jsonBody(req)), req.user, req) });
});
managerRouter.post('/staff/:id/reactivate', async (req, res) => {
  res.json({ staff: await reactivateStaff(req.branch, req.params.id, req.user, req) });
});
managerRouter.post('/staff/:id/password', async (req, res) => {
  res.json({ staff: await resetStaffPassword(req.branch, req.params.id, readStaffPassword(jsonBody(req)), req.user, req) });
});
managerRouter.get('/staff/:id/assignments', async (req, res) => {
  res.json(await listAssignments(req.branch, req.params.id));
});
managerRouter.post('/staff/:id/assignments', async (req, res) => {
  res.json({ staff: await saveAssignments(req.branch, req.params.id, readAssignmentChange(jsonBody(req)), req.user, req) });
});
managerRouter.delete('/staff/:id/assignments/scheduled', async (req, res) => {
  res.json({ staff: await cancelScheduledAssignments(req.branch, req.params.id, req.user, req) });
});

// ---- Attendance reports (read only; docs/reports/): the Manager's current branch only ----
// req.branch is read from the database on every request, so after a transfer only the new branch is
// reported; a branch in the request is refused (reportInput.js).
const managerScope = (req) => ({ schoolId: req.branch.school.id, branchId: req.branch.id });

/** A report query with the optional academic year filter applied (dates inside the year; see applyAcademicYearFilter). */
async function reportQuery(req, read, today) {
  const { query, academicYear } = await applyAcademicYearFilter(req.query, req.branch.school.id, today);
  const filters = read(query, { role: 'MANAGER', today });
  return academicYear ? { ...filters, academicYear: academicYear.name } : filters;
}

managerRouter.get('/attendance/summary', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceSummary(managerScope(req), await reportQuery(req, readSummaryQuery, today), { today }));
});
managerRouter.get('/attendance/records', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceRecords(managerScope(req), await reportQuery(req, readRecordsQuery, today), { today }));
});
managerRouter.get('/attendance/options', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceOptions(managerScope(req), await reportQuery(req, readOptionsQuery, today), { today }));
});
// Exports of every record of the current branch matching the filters (at most 10,000 rows, refused rather than truncated): CSV (data only), Excel and PDF.
managerRouter.get('/attendance/export.csv', async (req, res) => {
  const today = await reportToday();
  await sendCsvExport(res, 'MANAGER', managerScope(req), await reportQuery(req, readExportQuery, today));
});
managerRouter.get('/attendance/export.xlsx', async (req, res) => {
  const today = await reportToday();
  await sendXlsxExport(res, 'MANAGER', managerScope(req), await reportQuery(req, readExportQuery, today));
});
managerRouter.get('/attendance/export.pdf', async (req, res) => {
  const today = await reportToday();
  await sendPdfExport(res, 'MANAGER', managerScope(req), await reportQuery(req, readExportQuery, today));
});
// Preview of an export (JSON): heading, summary and total of every matching row, and the first 50 rows
// as the files write them. Not the download's data: each download reads and checks everything again.
managerRouter.get('/attendance/export/preview', async (req, res) => {
  const today = await reportToday();
  res.json(await previewExport('MANAGER', managerScope(req), await reportQuery(req, readExportQuery, today)));
});

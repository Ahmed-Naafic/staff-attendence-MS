import { jsonBody } from '../../common/validate.js';
import { requireStudentAttendance } from '../../middleware/requireStudentAttendance.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { cancelExcuse, createExcuse, listExcuses } from './excuses.service.js';
import { dayOverview, getSession, openSession, refreshRoster, saveMarks, sessionHistory } from './halfDay.service.js';
import { openLessonSession } from './lessonAttendance.service.js';
import { completion, readCompletionQuery } from './completion.js';
import { buildReport, readHistoryQuery, readReportQuery, studentAttendanceHistory, studentAttendanceReport } from './reports.service.js';
import { sendReportCsv, sendReportXlsx } from './reportExport.js';
import { forbidden } from '../../common/httpError.js';
import { getSettings, readSettingsChange, saveBranchSettings, saveSchoolSettings } from './settings.js';
import { readDayQuery, readExcuseCreation, readExcuseQuery, readMarks, readSessionOpening } from './studentAttendanceInput.js';

/*
 * Student attendance routes (docs/business-rules.md → Student attendance), the same for the School
 * Owner (/api/owner) and a Manager (/api/manager): the scope decides what each sees and changes.
 * `scopeOf(req)` → { school, branch } from the signed-in account; `role`: 'OWNER' | 'MANAGER'.
 *
 * Settings are available whether or not Student Attendance is switched on (a school prepares
 * first); everything else answers 403 FEATURE_DISABLED while it is off.
 */
export function mountStudentAttendanceRoutes(router, scopeOf, role) {
  router.get('/student-attendance/settings', async (req, res) => {
    const branch = role === 'OWNER' && typeof req.query.branch === 'string' && req.query.branch ? req.query.branch : undefined;
    res.json(await getSettings(scopeOf(req), { branch }));
  });
  router.put('/student-attendance/settings', async (req, res) => {
    const change = readSettingsChange(jsonBody(req), { role });
    const scope = scopeOf(req);
    res.json(role === 'OWNER' ? await saveSchoolSettings(scope, change, req.user, req) : await saveBranchSettings(scope, change, req.user, req));
  });

  const enabled = requireStudentAttendance((req) => scopeOf(req).school.id);

  router.get('/student-attendance/day', enabled, async (req, res) => {
    res.json(await dayOverview(scopeOf(req), readDayQuery(req.query, { today: await calendarToday(), role })));
  });
  // Completion by day and branch: what was taken, what is missing or incomplete.
  router.get('/student-attendance/completion', enabled, async (req, res) => {
    res.json(await completion(scopeOf(req), readCompletionQuery(req.query, { today: await calendarToday(), role })));
  });
  // Reports (read only): totals, sections, students (one page); exports of the whole report.
  router.get('/student-attendance/reports', enabled, async (req, res) => {
    res.json(await studentAttendanceReport(scopeOf(req), readReportQuery(req.query, { today: await calendarToday(), role })));
  });
  const exportContext = async (req) => {
    const scope = scopeOf(req);
    const filters = readReportQuery(req.query, { today: await calendarToday(), role });
    const report = await buildReport(scope, filters);
    const branchName = scope.branch?.name ?? (filters.branch ? report.branches[0]?.name : 'All branches');
    return { scope, report, code: scope.branch?.code ?? scope.school.code, context: { schoolName: scope.school.name, scopeName: branchName, generatedBy: req.user.name } };
  };
  router.get('/student-attendance/reports/export.csv', enabled, async (req, res) => {
    const { report, code } = await exportContext(req);
    sendReportCsv(res, { role, report, code });
  });
  router.get('/student-attendance/reports/export.xlsx', enabled, async (req, res) => {
    const { report, code, context } = await exportContext(req);
    sendReportXlsx(res, { role, report, code, context });
  });
  // One student's attendance, session by session.
  router.get('/student-attendance/students/:id', enabled, async (req, res) => {
    res.json(await studentAttendanceHistory(scopeOf(req), req.params.id, readHistoryQuery(req.query, { today: await calendarToday() })));
  });
  router.post('/student-attendance/sessions', enabled, async (req, res) => {
    const values = readSessionOpening(jsonBody(req));
    const scope = scopeOf(req);
    if (values.period !== undefined && !scope.branch) throw forbidden('Managers take student attendance for their branch. You can view it here.');
    const result = values.period !== undefined ? await openLessonSession(scope, values, req.user, req) : await openSession(scope, values, req.user, req);
    res.status(result.created ? 201 : 200).json(result);
  });
  router.get('/student-attendance/sessions/:id', enabled, async (req, res) => {
    res.json(await getSession(scopeOf(req), req.params.id));
  });
  router.put('/student-attendance/sessions/:id/marks', enabled, async (req, res) => {
    res.json(await saveMarks(scopeOf(req), req.params.id, readMarks(jsonBody(req)), req.user, req));
  });
  // Adds students enrolled in the section since the session opened.
  router.post('/student-attendance/sessions/:id/class-list', enabled, async (req, res) => {
    res.json(await refreshRoster(scopeOf(req), req.params.id, req.user, req));
  });
  router.get('/student-attendance/sessions/:id/history', enabled, async (req, res) => {
    res.json(await sessionHistory(scopeOf(req), req.params.id));
  });

  router.get('/student-excuses', enabled, async (req, res) => {
    res.json(await listExcuses(scopeOf(req), readExcuseQuery(req.query, { role })));
  });
  router.post('/student-excuses', enabled, async (req, res) => {
    res.status(201).json({ excuse: await createExcuse(scopeOf(req), readExcuseCreation(jsonBody(req)), req.user, req) });
  });
  router.post('/student-excuses/:id/cancel', enabled, async (req, res) => {
    res.json({ excuse: await cancelExcuse(scopeOf(req), req.params.id, req.user, req) });
  });
}

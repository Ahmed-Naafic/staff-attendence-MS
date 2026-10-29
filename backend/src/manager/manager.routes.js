import { Router } from 'express';
import { fromDbStatus } from '../common/listQuery.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireManagerBranch } from '../middleware/requireManagerBranch.js';
import { readListQuery } from '../common/listQuery.js';
import { jsonBody } from '../common/validate.js';
import { attendanceOptions, attendanceRecords, attendanceSummary, reportToday } from '../features/attendance/attendanceReports.service.js';
import { previewExport, sendCsvExport, sendPdfExport, sendXlsxExport } from '../features/attendance/attendanceExport.js';
import { readExportQuery, readOptionsQuery, readRecordsQuery, readSummaryQuery } from '../features/attendance/reportInput.js';
import { operatingState } from '../features/branches/branches.service.js';
import { readScheduleChange } from '../features/schedules/scheduleInput.js';
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

managerRouter.get('/attendance/summary', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceSummary(managerScope(req), readSummaryQuery(req.query, { role: 'MANAGER', today }), { today }));
});
managerRouter.get('/attendance/records', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceRecords(managerScope(req), readRecordsQuery(req.query, { role: 'MANAGER', today }), { today }));
});
managerRouter.get('/attendance/options', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceOptions(managerScope(req), readOptionsQuery(req.query, { role: 'MANAGER', today }), { today }));
});
// Exports of every record of the current branch matching the filters (at most 10,000 rows, refused rather than truncated): CSV (data only), Excel and PDF.
managerRouter.get('/attendance/export.csv', async (req, res) => {
  const today = await reportToday();
  await sendCsvExport(res, 'MANAGER', managerScope(req), readExportQuery(req.query, { role: 'MANAGER', today }));
});
managerRouter.get('/attendance/export.xlsx', async (req, res) => {
  const today = await reportToday();
  await sendXlsxExport(res, 'MANAGER', managerScope(req), readExportQuery(req.query, { role: 'MANAGER', today }));
});
managerRouter.get('/attendance/export.pdf', async (req, res) => {
  const today = await reportToday();
  await sendPdfExport(res, 'MANAGER', managerScope(req), readExportQuery(req.query, { role: 'MANAGER', today }));
});
// Preview of an export (JSON): heading, summary and total of every matching row, and the first 50 rows
// as the files write them. Not the download's data: each download reads and checks everything again.
managerRouter.get('/attendance/export/preview', async (req, res) => {
  const today = await reportToday();
  res.json(await previewExport('MANAGER', managerScope(req), readExportQuery(req.query, { role: 'MANAGER', today })));
});

import { Router } from 'express';
import { readListQuery } from '../common/listQuery.js';
import { badRequest } from '../common/httpError.js';
import { isUuid, jsonBody, optionalInt, optionalString } from '../common/validate.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireOwnerSchool } from '../middleware/requireOwnerSchool.js';
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

ownerRouter.get('/attendance/summary', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceSummary(ownerScope(req), readSummaryQuery(req.query, { role: 'OWNER', today }), { compareBranches: true, today }));
});
ownerRouter.get('/attendance/records', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceRecords(ownerScope(req), readRecordsQuery(req.query, { role: 'OWNER', today }), { withBranch: true, today }));
});
ownerRouter.get('/attendance/options', async (req, res) => {
  const today = await reportToday();
  res.json(await attendanceOptions(ownerScope(req), readOptionsQuery(req.query, { role: 'OWNER', today }), { listBranches: true, today }));
});
// Exports of every record matching the filters (at most 10,000 rows, refused rather than truncated): CSV (data only), Excel and PDF.
ownerRouter.get('/attendance/export.csv', async (req, res) => {
  const today = await reportToday();
  await sendCsvExport(res, 'OWNER', ownerScope(req), readExportQuery(req.query, { role: 'OWNER', today }));
});
ownerRouter.get('/attendance/export.xlsx', async (req, res) => {
  const today = await reportToday();
  await sendXlsxExport(res, 'OWNER', ownerScope(req), readExportQuery(req.query, { role: 'OWNER', today }));
});
ownerRouter.get('/attendance/export.pdf', async (req, res) => {
  const today = await reportToday();
  await sendPdfExport(res, 'OWNER', ownerScope(req), readExportQuery(req.query, { role: 'OWNER', today }));
});
// Preview of an export (JSON): heading, summary and total of every matching row, and the first 50 rows
// as the files write them. Not the download's data: each download reads and checks everything again.
ownerRouter.get('/attendance/export/preview', async (req, res) => {
  const today = await reportToday();
  res.json(await previewExport('OWNER', ownerScope(req), readExportQuery(req.query, { role: 'OWNER', today })));
});

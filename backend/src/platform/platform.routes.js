import { Router } from 'express';
import { OWNER_STATUSES, readListQuery, SCHOOL_STATUSES } from '../common/listQuery.js';
import { isUuid, jsonBody, optionalDate, optionalEnum, optionalInt, optionalString, optionalTimeZone } from '../common/validate.js';
import { badRequest } from '../common/httpError.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { FILTERABLE_ACTIONS } from '../features/audit-logs/auditActions.js';
import { getAuditEvent, listAuditEvents } from '../features/audit-logs/auditQuery.service.js';
import { DASHBOARD_RANGES, getDashboard } from '../features/dashboard/dashboard.service.js';
import { getSettings } from '../features/platform-settings/settings.service.js';
import { getReport, REPORT_PERIODS } from '../features/reports/reports.service.js';
import { readOwnerCreation, readOwnerSuspension, readOwnerUpdate } from '../features/school-owners/ownerInput.js';
import { createOwner, getOwner, listOwners, reactivateOwner, suspendOwner, updateOwner } from '../features/school-owners/owners.service.js';
import { readRegistration, readSuspension, readUpdate } from '../features/schools/schoolInput.js';
import { getSchool, listSchools, reactivateSchool, registerSchool, suggestCode, suspendSchool, updateSchool } from '../features/schools/schools.service.js';

/**
 * Super Admin platform API (/api/platform). Every route requires a signed-in SUPER_ADMIN:
 * PLATFORM scope, so no school or branch restriction applies — and no branch, staff or
 * attendance operations are exposed here. Writes exist only for School Management (register,
 * edit, suspend, reactivate) and School Owner Management (add, edit, suspend, reactivate);
 * there is no approval, rejection, transfer or deletion.
 */
export const platformRouter = Router();
platformRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

const optionalId = (query, name) => {
  const value = optionalString(query, name, { max: 64 });
  if (value !== undefined && !isUuid(value)) throw badRequest(`"${name}" must be an id.`);
  return value;
};

platformRouter.get('/dashboard', async (req, res) => {
  const range = optionalEnum(req.query, 'range', Object.keys(DASHBOARD_RANGES)) ?? '30d';
  res.json(await getDashboard({ range, tz: optionalTimeZone(req.query, 'tz') }));
});

platformRouter.get('/schools', async (req, res) => {
  res.json(
    await listSchools({
      ...readListQuery(req.query, { statuses: SCHOOL_STATUSES, defaultPageSize: 8 }),
      // owner=none: schools without an owner (the Add Owner form lists them).
      withoutOwner: optionalEnum(req.query, 'owner', ['none']) === 'none',
    }),
  );
});
// Suggested School Code for a name (the admin may change it before registering).
platformRouter.get('/schools/code-suggestion', async (req, res) => {
  res.json({ code: await suggestCode(optionalString(req.query, 'name', { max: 120 }) ?? '') });
});
platformRouter.get('/schools/:id', async (req, res) => {
  res.json({ school: await getSchool(req.params.id) });
});
platformRouter.post('/schools', async (req, res) => {
  res.status(201).json({ school: await registerSchool(readRegistration(jsonBody(req)), req.user, req) });
});
platformRouter.patch('/schools/:id', async (req, res) => {
  res.json({ school: await updateSchool(req.params.id, readUpdate(jsonBody(req)), req.user, req) });
});
platformRouter.post('/schools/:id/suspend', async (req, res) => {
  res.json({ school: await suspendSchool(req.params.id, readSuspension(jsonBody(req)), req.user, req) });
});
platformRouter.post('/schools/:id/reactivate', async (req, res) => {
  res.json({ school: await reactivateSchool(req.params.id, req.user, req) });
});

platformRouter.get('/owners', async (req, res) => {
  res.json(await listOwners(readListQuery(req.query, { statuses: OWNER_STATUSES, defaultPageSize: 8 })));
});
platformRouter.get('/owners/:id', async (req, res) => {
  res.json({ owner: await getOwner(req.params.id) });
});
platformRouter.post('/owners', async (req, res) => {
  res.status(201).json({ owner: await createOwner(readOwnerCreation(jsonBody(req)), req.user, req) });
});
platformRouter.patch('/owners/:id', async (req, res) => {
  res.json({ owner: await updateOwner(req.params.id, readOwnerUpdate(jsonBody(req)), req.user, req) });
});
platformRouter.post('/owners/:id/suspend', async (req, res) => {
  res.json({ owner: await suspendOwner(req.params.id, readOwnerSuspension(jsonBody(req)), req.user, req) });
});
platformRouter.post('/owners/:id/reactivate', async (req, res) => {
  res.json({ owner: await reactivateOwner(req.params.id, req.user, req) });
});

platformRouter.get('/reports', async (req, res) => {
  const period = optionalEnum(req.query, 'period', Object.keys(REPORT_PERIODS)) ?? '12m';
  res.json(await getReport({ period, tz: optionalTimeZone(req.query, 'tz') }));
});

platformRouter.get('/audit-logs', async (req, res) => {
  const q = req.query;
  const since = optionalDate(q, 'since');
  const until = optionalDate(q, 'until');
  if (since && until && since > until) throw badRequest('"since" must be before "until".');
  res.json(
    await listAuditEvents({
      q: optionalString(q, 'q', { max: 100 }),
      action: optionalEnum(q, 'action', FILTERABLE_ACTIONS),
      user: optionalId(q, 'user'),
      school: optionalId(q, 'school'),
      status: optionalEnum(q, 'status', ['success', 'failure']),
      since,
      until,
      dayStart: optionalDate(q, 'dayStart'),
      page: optionalInt(q, 'page', { min: 1, max: 100000, fallback: 1 }),
      pageSize: optionalInt(q, 'pageSize', { min: 1, max: 100, fallback: 10 }),
    }),
  );
});
platformRouter.get('/audit-logs/:id', async (req, res) => {
  res.json({ event: await getAuditEvent(req.params.id) });
});

platformRouter.get('/settings', async (req, res) => {
  res.json(await getSettings());
});

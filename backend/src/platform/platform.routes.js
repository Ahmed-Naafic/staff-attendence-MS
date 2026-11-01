import { Router } from 'express';
import { OWNER_STATUSES, readListQuery, SCHOOL_STATUSES } from '../common/listQuery.js';
import { isUuid, jsonBody, optionalDate, optionalEnum, optionalInt, optionalString } from '../common/validate.js';
import { badRequest } from '../common/httpError.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { FILTERABLE_ACTIONS } from '../features/audit-logs/auditActions.js';
import { getAuditEvent, listAuditEvents } from '../features/audit-logs/auditQuery.service.js';
import { DASHBOARD_RANGES, getDashboard } from '../features/dashboard/dashboard.service.js';
import { readAuthentication } from '../features/platform-settings/authenticationInput.js';
import { readBranding } from '../features/platform-settings/brandingInput.js';
import { readGeneral } from '../features/platform-settings/generalInput.js';
import { readScheduling, updateScheduling } from '../features/platform-settings/schedulingPolicy.js';
import {
  getSettings,
  platformTimeZone,
  updateAuthentication,
  updateBranding,
  updateGeneral,
} from '../features/platform-settings/settings.service.js';
import { getReport, REPORT_PERIODS } from '../features/reports/reports.service.js';
import {
  ANNOUNCEMENT_FILTERS,
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
  withdrawAnnouncement,
} from '../features/notifications/announcements.service.js';
import { platformLimits, platformNotificationSettings, updatePlatformNotificationSettings } from '../features/notifications/notificationSettings.service.js';
import { readOwnerCreation, readOwnerSuspension, readOwnerUpdate } from '../features/school-owners/ownerInput.js';
import { createOwner, getOwner, listOwners, reactivateOwner, suspendOwner, updateOwner } from '../features/school-owners/owners.service.js';
import { backupsRouter } from '../features/backups/backups.routes.js';
import { readRegistration, readSuspension, readUpdate } from '../features/schools/schoolInput.js';
import { getSchool, listSchools, reactivateSchool, registerSchool, suggestCode, suspendSchool, updateSchool } from '../features/schools/schools.service.js';

/**
 * Super Admin platform API (/api/platform). Every route requires a signed-in SUPER_ADMIN:
 * PLATFORM scope, so no school or branch restriction applies — and no branch, staff or
 * attendance operations are exposed here. Writes exist only for School Management (register,
 * edit, suspend, reactivate), School Owner Management (add, edit, suspend, reactivate),
 * Branding (the platform name), General settings (platform information and localization) and
 * Authentication (the session lifetime and inactivity timeout); there is no approval, rejection,
 * transfer or deletion. Calendar days and months (Dashboard, Reports) use the platform time zone
 * (Platform Settings → General); a `tz` query parameter is ignored.
 */
export const platformRouter = Router();
platformRouter.use(requireAuth, requireRole('SUPER_ADMIN'));
// Data & Backup (Platform Settings → Data & Backup; docs/data-backup/).
platformRouter.use('/backups', backupsRouter);

const optionalId = (query, name) => {
  const value = optionalString(query, name, { max: 64 });
  if (value !== undefined && !isUuid(value)) throw badRequest(`"${name}" must be an id.`);
  return value;
};

platformRouter.get('/dashboard', async (req, res) => {
  const range = optionalEnum(req.query, 'range', Object.keys(DASHBOARD_RANGES)) ?? '30d';
  res.json(await getDashboard({ range, tz: await platformTimeZone() }));
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

// Read-only. period: trend period; status and city: school filters (owner figures are not filtered).
platformRouter.get('/reports', async (req, res) => {
  res.json(
    await getReport({
      period: optionalEnum(req.query, 'period', Object.keys(REPORT_PERIODS)) ?? '12m',
      status: optionalEnum(req.query, 'status', SCHOOL_STATUSES),
      city: optionalString(req.query, 'city', { max: 100 }),
      tz: await platformTimeZone(),
    }),
  );
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
// General: platform information and localization (not the platform name, which is Branding).
platformRouter.put('/settings/general', async (req, res) => {
  res.json({ general: await updateGeneral(readGeneral(jsonBody(req)), req.user, req) });
});
// Branding: the platform name only.
platformRouter.put('/settings/branding', async (req, res) => {
  res.json({ branding: await updateBranding(readBranding(jsonBody(req)), req.user, req) });
});
// Authentication: the session lifetime and inactivity timeout only. The other authentication values are fixed.
platformRouter.put('/settings/authentication', async (req, res) => {
  res.json({ authentication: await updateAuthentication(readAuthentication(jsonBody(req)), req.user, req) });
});
// Scheduling & Assignments: the effective delay and whether a first schedule / first assignments may start today.
platformRouter.put('/settings/scheduling', async (req, res) => {
  res.json({ scheduling: await updateScheduling(readScheduling(jsonBody(req)), req.user, req) });
});
// Notifications: reminder defaults and limits, push on/off and the digest hour (N5).
platformRouter.get('/settings/notifications', async (req, res) => {
  res.json({ notifications: await platformNotificationSettings(), limits: platformLimits() });
});
platformRouter.put('/settings/notifications', async (req, res) => {
  res.json({ notifications: await updatePlatformNotificationSettings(jsonBody(req), req.user, req), limits: platformLimits() });
});

// Platform announcements (N17).
platformRouter.get('/announcements', async (req, res) => {
  res.json(
    await listAnnouncements({
      status: optionalEnum(req.query, 'status', ANNOUNCEMENT_FILTERS),
      q: optionalString(req.query, 'q', { max: 100 }),
      page: optionalInt(req.query, 'page', { min: 1, max: 100000, fallback: 1 }),
      pageSize: optionalInt(req.query, 'pageSize', { min: 1, max: 100, fallback: 10 }),
    }),
  );
});
platformRouter.get('/announcements/:id', async (req, res) => {
  res.json({ announcement: await getAnnouncement(req.params.id) });
});
platformRouter.post('/announcements', async (req, res) => {
  res.status(201).json({ announcement: await createAnnouncement(jsonBody(req), req.user, req) });
});
platformRouter.patch('/announcements/:id', async (req, res) => {
  res.json({ announcement: await updateAnnouncement(req.params.id, jsonBody(req), req.user, req) });
});
platformRouter.post('/announcements/:id/publish', async (req, res) => {
  res.json({ announcement: await publishAnnouncement(req.params.id, jsonBody(req), req.user, req) });
});
platformRouter.post('/announcements/:id/withdraw', async (req, res) => {
  res.json({ announcement: await withdrawAnnouncement(req.params.id, req.user, req) });
});

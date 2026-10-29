import { Router } from 'express';
import { forbidden } from '../common/httpError.js';
import { jsonBody, optionalDay } from '../common/validate.js';
import { getPrisma } from '../config/prisma.js';
import { readAttendanceEvent } from '../features/attendance/attendanceInput.js';
import { history, profile, recordEvent, today } from '../features/attendance/attendance.service.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

/**
 * Staff attendance API (/api/attendance), used by the Staff mobile app (bearer token) — the web app
 * has no attendance screens. Every route requires a signed-in STAFF account that has replaced its
 * temporary password (requireAuth); the staff member's branch is read from the database on every
 * request, never from the request (docs/business-rules.md → Attendance check-in and check-out).
 */
export const attendanceRouter = Router();
attendanceRouter.use(requireAuth, requireRole('STAFF'), async (req, res, next) => {
  const staff = await getPrisma().user.findFirst({ where: { id: req.user.id, role: 'STAFF' }, select: { id: true, branchId: true } });
  if (!staff?.branchId) return next(forbidden('No branch is assigned to your account.'));
  req.staff = staff;
  next();
});

attendanceRouter.get('/today', async (req, res) => {
  res.json(await today(req.staff));
});

attendanceRouter.get('/profile', async (req, res) => {
  res.json(await profile(req.staff));
});

attendanceRouter.get('/history', async (req, res) => {
  res.json(await history(req.staff, { from: optionalDay(req.query, 'from'), to: optionalDay(req.query, 'to') }));
});

// 201 for a new event; 200 when the same event (same clientEventId and content) was already recorded.
attendanceRouter.post('/events', async (req, res) => {
  const receivedAt = new Date();
  const { created, event } = await recordEvent(req.staff, readAttendanceEvent(jsonBody(req)), receivedAt);
  res.status(created ? 201 : 200).json({ event });
});

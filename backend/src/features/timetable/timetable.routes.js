import { jsonBody } from '../../common/validate.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import {
  cancelBellTimes,
  cancelTimetableVersion,
  createBellSchedule,
  getBellSchedule,
  getTimetable,
  listBellSchedules,
  listTimetables,
  saveBellTimes,
  saveTimetable,
  sectionLessons,
  setBellScheduleStatus,
  teacherLessons,
  updateBellSchedule,
} from './timetable.service.js';
import {
  readBellListQuery,
  readBellScheduleCreation,
  readBellScheduleUpdate,
  readBellVersion,
  readLessonsQuery,
  readOverviewQuery,
  readTimetableQuery,
  readTimetableVersion,
} from './timetableInput.js';

/*
 * Bell schedule and timetable routes (docs/business-rules.md → Bell schedules; Timetables), the same
 * for the School Owner (/api/owner) and a Manager (/api/manager): the scope decides what each sees
 * and changes. `scopeOf(req)` → { school, branch } from the signed-in account; `role`: 'OWNER' | 'MANAGER'.
 * Academic setup: available whether or not Student Attendance is switched on for the school.
 */
export function mountTimetableRoutes(router, scopeOf, role) {
  router.get('/bell-schedules', async (req, res) => {
    res.json(await listBellSchedules(scopeOf(req), readBellListQuery(req.query, { role })));
  });
  router.post('/bell-schedules', async (req, res) => {
    res.status(201).json({ bellSchedule: await createBellSchedule(scopeOf(req), readBellScheduleCreation(jsonBody(req), { role }), req.user, req) });
  });
  router.get('/bell-schedules/:id', async (req, res) => {
    res.json(await getBellSchedule(scopeOf(req), req.params.id));
  });
  router.patch('/bell-schedules/:id', async (req, res) => {
    res.json({ bellSchedule: await updateBellSchedule(scopeOf(req), req.params.id, readBellScheduleUpdate(jsonBody(req)), req.user, req) });
  });
  router.post('/bell-schedules/:id/deactivate', async (req, res) => {
    res.json({ bellSchedule: await setBellScheduleStatus(scopeOf(req), req.params.id, false, req.user, req) });
  });
  router.post('/bell-schedules/:id/reactivate', async (req, res) => {
    res.json({ bellSchedule: await setBellScheduleStatus(scopeOf(req), req.params.id, true, req.user, req) });
  });
  router.put('/bell-schedules/:id/times', async (req, res) => {
    res.json(await saveBellTimes(scopeOf(req), req.params.id, readBellVersion(jsonBody(req)), req.user, req));
  });
  router.post('/bell-schedules/:id/times/:versionId/cancel', async (req, res) => {
    res.json(await cancelBellTimes(scopeOf(req), req.params.id, req.params.versionId, req.user, req));
  });

  router.get('/timetables', async (req, res) => {
    res.json(await listTimetables(scopeOf(req), readOverviewQuery(req.query, { role })));
  });
  router.get('/sections/:id/timetable', async (req, res) => {
    res.json(await getTimetable(scopeOf(req), req.params.id, readTimetableQuery(req.query)));
  });
  router.put('/sections/:id/timetable', async (req, res) => {
    res.json(await saveTimetable(scopeOf(req), req.params.id, readTimetableVersion(jsonBody(req)), req.user, req));
  });
  router.post('/sections/:id/timetable/:versionId/cancel', async (req, res) => {
    res.json(await cancelTimetableVersion(scopeOf(req), req.params.id, req.params.versionId, req.user, req));
  });
  // What happens on each day from..to (default: this week): school or not, bell times, halves, lessons.
  router.get('/sections/:id/lessons', async (req, res) => {
    res.json(await sectionLessons(scopeOf(req), req.params.id, readLessonsQuery(req.query, { today: await calendarToday() })));
  });
  // A teacher's lessons from..to (default: this week), across the sections in scope.
  router.get('/teachers/:id/lessons', async (req, res) => {
    res.json(await teacherLessons(scopeOf(req), req.params.id, readLessonsQuery(req.query, { today: await calendarToday() })));
  });
}

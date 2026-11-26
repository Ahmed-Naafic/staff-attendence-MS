import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navigationByRole } from './navigation.js';

const links = (role) => navigationByRole[role].flatMap((s) => s.items.flatMap((i) => i.children ?? [i]));
const SCHEDULE_PAGES = ['/academic-years', '/academic-calendar', '/bell-schedules', '/timetable-builder', '/timetable-views', '/timetables'];

test('navigation: the school schedule pages (year, calendar, bells, timetables) are under one School Schedule menu for School Owners and Managers, each once', () => {
  for (const role of ['OWNER', 'MANAGER']) {
    const top = navigationByRole[role].flatMap((s) => s.items);
    const group = top.find((i) => i.id === 'school-schedule');
    assert.ok(group, role);
    assert.deepEqual(group.children.map((c) => c.to), SCHEDULE_PAGES);
    for (const to of SCHEDULE_PAGES) assert.ok(!top.some((i) => i.to === to), `${role}: ${to} is only in the group`);
    const all = links(role).map((l) => l.to);
    assert.equal(new Set(all).size, all.length, `${role}: no page twice`);
    assert.ok(!all.includes('/schedule') || role === 'MANAGER', 'Staff Schedule is only the Manager menu');
    for (const l of links(role)) assert.ok(l.to && l.label && l.icon, `${role}: ${l.label}`);
  }
});

test('navigation: staff pages (list, Staff Schedule, Staff Attendance) are under one Staff menu; Staff Schedule only for Managers', () => {
  const expected = { OWNER: ['/staff', '/attendance'], MANAGER: ['/staff', '/schedule', '/attendance'] };
  for (const [role, pages] of Object.entries(expected)) {
    const top = navigationByRole[role].flatMap((s) => s.items);
    const group = top.find((i) => i.id === 'staff');
    assert.ok(group, role);
    assert.deepEqual(group.children.map((c) => c.to), pages);
    for (const to of pages) assert.ok(!top.some((i) => i.to === to), `${role}: ${to} is only in the group`);
  }
});

test('navigation: student pages (list, promotion, attendance, excuses, reports) are under one Students menu for School Owners and Managers', () => {
  const pages = ['/students', '/promotions', '/student-attendance', '/student-excuses', '/student-attendance/reports'];
  for (const role of ['OWNER', 'MANAGER']) {
    const top = navigationByRole[role].flatMap((s) => s.items);
    const group = top.find((i) => i.id === 'students');
    assert.ok(group, role);
    assert.deepEqual(group.children.map((c) => c.to), pages);
    for (const to of pages) assert.ok(!top.some((i) => i.to === to), `${role}: ${to} is only in the group`);
  }
});

test('navigation: inside a menu only the closest page lights up (Student Reports, not Student Attendance, on the reports page)', async () => {
  const { groupChildren } = await import('../../components/layout/groupChildren.js');
  const kids = navigationByRole.MANAGER.flatMap((s) => s.items).find((i) => i.id === 'students').children;
  const ended = (path) => groupChildren(kids, path).filter((c) => c.end).map((c) => c.to);
  assert.deepEqual(ended('/student-attendance/reports'), ['/student-attendance']);
  assert.deepEqual(ended('/student-attendance/sessions/1'), []);
  assert.deepEqual(ended('/students/5'), []);
});

test('Timetable is a menu item of its own, right after School Schedule (School Owner and Manager)', () => {
  for (const role of ['OWNER', 'MANAGER']) {
    const top = navigationByRole[role].flatMap((s) => s.items);
    const at = top.findIndex((i) => i.id === 'school-schedule');
    assert.equal(top[at + 1]?.to, '/timetable', role);
  }
});

test('the timetable steps: every step is a page of its own, in the order of the guide', async () => {
  const { TIMETABLE_STEPS, stepOf } = await import('../../features/timetable-builder/utils/timetableSteps.js');
  const { sharedSearch, BUILDER_TAB_STEP } = await import('../../features/timetable-builder/utils/timetableSteps.js');
  // The same keys, in the same order, as the server's progress (builder.service.js PROGRESS_STEPS).
  assert.deepEqual(TIMETABLE_STEPS.map((s) => s.key), ['year', 'school-days', 'bell-times', 'subjects', 'classes', 'lessons', 'teachers', 'assign', 'limits', 'rules', 'fixed', 'readiness', 'generate', 'publish', 'view']);
  assert.deepEqual([...new Set(TIMETABLE_STEPS.map((s) => s.group))], ['Calendar', 'Curriculum', 'Staff', 'Build', 'Result']);
  for (const s of TIMETABLE_STEPS) assert.ok(s.label && s.what && s.who && s.group, s.key);
  assert.equal(stepOf('unknown').key, 'year', 'an unknown step opens the first');
  const lessons = stepOf('lessons');
  assert.deepEqual([lessons.number, lessons.previous.key, lessons.next.key], [6, 'classes', 'teachers']);
  assert.equal(stepOf('view').next, null);
  // Only the year and branch go along to the next step.
  assert.equal(sharedSearch('?year=y1&branch=b1&tab=rules&section=s'), '?year=y1&branch=b1');
  assert.equal(sharedSearch('?tab=x'), '');
  assert.equal(BUILDER_TAB_STEP.teachers, 'limits');
});

test('navigation: the nine Examinations pages are under one Examinations menu for School Owners and Managers', () => {
  const pages = ['/examinations', '/examinations/list', '/examinations/setup', '/examinations/rooms', '/examinations/timetable', '/examinations/marks', '/examinations/results', '/examinations/analytics', '/examinations/settings'];
  for (const role of ['OWNER', 'MANAGER']) {
    const group = navigationByRole[role].flatMap((s) => s.items).find((i) => i.id === 'examinations');
    assert.ok(group, role);
    assert.deepEqual(group.children.map((c) => c.to), pages);
  }
  assert.ok(!links('SUPER_ADMIN').some((l) => l.to.startsWith('/examinations')));
});

test('navigation: School Owners and Managers start on their Dashboard, the first item of their menu', async () => {
  const { roleProfiles } = await import('./navigation.js');
  for (const role of ['OWNER', 'MANAGER']) {
    assert.equal(roleProfiles[role].home, '/dashboard', role);
    assert.equal(navigationByRole[role][0].items[0].to, '/dashboard', role);
  }
  assert.ok(!links('ACCOUNTANT').some((l) => l.to === '/dashboard'), 'Accountants keep the Fee overview');
});

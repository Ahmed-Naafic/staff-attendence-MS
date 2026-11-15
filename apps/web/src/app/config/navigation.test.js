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

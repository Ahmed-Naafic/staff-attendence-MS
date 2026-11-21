/*
 * The teacher's classes and subjects: grouped by class (current year first, classes in number
 * order, class teacher first), the lesson and date texts, and the API answer's shape checked.
 */
import { checkTeaching } from '../../api/contracts';
import { assignmentTitle, datesText, lessonsText, teachingSections, teachingSummary } from '../teachingRules';

const cur = { id: 'y1', name: '2026-2027', status: 'current' };
const next = { id: 'y2', name: '2027-2028', status: 'planned' };
const item = (id, section, extra = {}) => ({
  id,
  role: 'subject',
  subject: { id: `s-${id}`, name: 'Maths' },
  section: { id: section, displayName: section, className: section },
  branch: { id: 'b1', name: 'Main' },
  academicYear: cur,
  startDate: '2026-09-01',
  endDate: null,
  state: 'active',
  weeklyLessons: 4,
  inTimetable: 4,
  ...extra,
});
const view = {
  date: '2026-11-16',
  items: [
    item('1', 'Grade 10A', { subject: { id: 'p', name: 'Physics' } }),
    item('2', 'Grade 2A', { subject: { id: 'm', name: 'Maths' } }),
    item('3', 'Grade 2A', { role: 'class', subject: null, weeklyLessons: null, inTimetable: null }),
    item('4', 'Grade 2A', { subject: { id: 'a', name: 'Arabic' }, inTimetable: 0 }),
    item('5', 'Grade 1A', { academicYear: next, state: 'scheduled', startDate: '2027-09-01', inTimetable: null }),
  ],
};

test('grouped by class: current year first, classes in number order, class teacher first then subjects A–Z', () => {
  const sections = teachingSections(view);
  expect(sections.map((s) => s.title)).toEqual(['Grade 2A', 'Grade 10A', 'Grade 1A']);
  expect(sections[0].data.map(assignmentTitle)).toEqual(['Class teacher', 'Arabic', 'Maths']);
  expect(teachingSummary(view)).toBe('3 classes · 4 subjects');
  expect(teachingSections({ items: [] })).toEqual([]);
});

test('lessons and dates are told plainly', () => {
  expect(lessonsText(view.items[1])).toBe('4 lessons a week · 4 in your timetable');
  expect(lessonsText(view.items[3])).toBe('4 lessons a week · not in the timetable yet');
  expect(lessonsText(view.items[2])).toBe('');
  expect(lessonsText(item('x', 'G', { weeklyLessons: null, inTimetable: null }))).toBe('');
  expect(lessonsText(item('x', 'G', { weeklyLessons: 1, inTimetable: null }))).toBe('1 lesson a week');
  expect(datesText(view.items[0])).toBe('From 2026-09-01');
  expect(datesText(item('x', 'G', { endDate: '2027-01-31' }))).toBe('From 2026-09-01 to 2027-01-31');
  expect(datesText(view.items[4])).toBe('Starts 2027-09-01');
});

test('the answer’s shape is checked', () => {
  expect(checkTeaching(view)).toBe(view);
  expect(() => checkTeaching({ date: '2026-11-16', items: [{ id: 'x', role: 'subject', section: { displayName: 'G' }, startDate: '2026-09-01' }] })).toThrow();
  expect(() => checkTeaching({ date: 'x', items: [] })).toThrow();
});

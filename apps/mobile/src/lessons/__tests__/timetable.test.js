/*
 * The teacher's week: grouped by school day in the school's order with today first, and the API
 * answer's shape checked.
 */
import { checkTimetable } from '../../api/contracts';
import { weekdayOf, weekSections, weekText } from '../timetableRules';

const lesson = (weekday, start, section = 'Grade 1A') => ({ weekday, period: 1, start, end: '08:10', section: { id: section, displayName: section }, subject: { id: 's', name: 'Maths' } });
const week = {
  date: '2026-11-16', // a Monday
  days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'],
  lessons: [lesson('MON', '09:00'), lesson('MON', '07:30', 'Grade 2A'), lesson('SAT', '07:30')],
  perDay: { MON: 2, SAT: 1 },
  total: 3,
};

test('days in the school’s order, today first, lessons by start time', () => {
  expect(weekdayOf('2026-11-16')).toBe('MON');
  const sections = weekSections(week, '2026-11-16');
  expect(sections.map((s) => s.day)).toEqual(['MON', 'TUE', 'WED', 'THU', 'SAT', 'SUN']);
  expect(sections[0].title).toBe('Monday (today)');
  expect(sections[0].data.map((l) => l.start)).toEqual(['07:30', '09:00']);
  expect(sections.find((s) => s.day === 'TUE').data).toEqual([]);
  expect(weekText(week)).toBe('3 lessons a week');
});

test('on a day without school the week starts on Saturday', () => {
  expect(weekSections(week, '2026-11-20').map((s) => s.day)[0]).toBe('SAT'); // a Friday
});

test('the answer’s shape is checked', () => {
  expect(checkTimetable(week)).toBe(week);
  expect(() => checkTimetable({ ...week, lessons: [{ weekday: 'MON' }] })).toThrow();
  expect(() => checkTimetable({ date: 'x' })).toThrow();
});

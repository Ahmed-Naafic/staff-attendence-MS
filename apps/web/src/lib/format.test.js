// Dates and times follow the platform display settings (time zone, date and time format).
// Run with `npm test --workspace apps/web`.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { formatDate, formatDateTime, platformDayStart, platformMidnight, setDisplaySettings } from './format.js';

// 22:30:05 UTC on 31 Dec 2025 = 01:30:05 on 1 Jan 2026 in Mogadishu (UTC+3).
const INSTANT = '2025-12-31T22:30:05Z';

afterEach(() => setDisplaySettings(null));

test('standard display (nothing set): UTC, "Mon DD, YYYY", 24-hour', () => {
  setDisplaySettings(null);
  assert.equal(formatDate(INSTANT), 'Dec 31, 2025');
  assert.equal(formatDateTime(INSTANT), 'Dec 31, 2025, 22:30:05');
});

test('the platform time zone decides the calendar date and clock time', () => {
  setDisplaySettings({ timeZone: 'Africa/Mogadishu' });
  assert.equal(formatDate(INSTANT), 'Jan 01, 2026');
  assert.equal(formatDateTime(INSTANT), 'Jan 01, 2026, 01:30:05');
});

test('each approved date format', () => {
  for (const [dateFormat, expected] of [
    ['YYYY-MM-DD', '2026-01-01'],
    ['DD/MM/YYYY', '01/01/2026'],
    ['MM/DD/YYYY', '01/01/2026'],
  ]) {
    setDisplaySettings({ timeZone: 'Africa/Mogadishu', dateFormat });
    assert.equal(formatDate(INSTANT), expected, dateFormat);
  }
  setDisplaySettings({ timeZone: 'UTC', dateFormat: 'DD/MM/YYYY' });
  assert.equal(formatDate('2026-03-07T12:00:00Z'), '07/03/2026');
  setDisplaySettings({ timeZone: 'UTC', dateFormat: 'MM/DD/YYYY' });
  assert.equal(formatDate('2026-03-07T12:00:00Z'), '03/07/2026');
});

test('12-hour and 24-hour time', () => {
  setDisplaySettings({ timeZone: 'UTC', dateFormat: 'YYYY-MM-DD', timeFormat: '12h' });
  assert.equal(formatDateTime('2026-03-07T00:05:09Z'), '2026-03-07, 12:05:09 AM');
  assert.equal(formatDateTime('2026-03-07T12:05:09Z'), '2026-03-07, 12:05:09 PM');
  assert.equal(formatDateTime('2026-03-07T23:05:09Z'), '2026-03-07, 11:05:09 PM');
  setDisplaySettings({ timeZone: 'UTC', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' });
  assert.equal(formatDateTime('2026-03-07T00:05:09Z'), '2026-03-07, 00:05:09');
});

test('days start at midnight in the platform time zone (audit date filters)', () => {
  setDisplaySettings({ timeZone: 'Africa/Mogadishu' });
  assert.equal(new Date(platformMidnight(2026, 1, 1)).toISOString(), '2025-12-31T21:00:00.000Z');
  assert.equal(new Date(platformDayStart(Date.parse(INSTANT))).toISOString(), '2025-12-31T21:00:00.000Z');
  setDisplaySettings({ timeZone: 'UTC' });
  assert.equal(new Date(platformDayStart(Date.parse(INSTANT))).toISOString(), '2025-12-31T00:00:00.000Z');
  // Across a daylight-saving change: New York is UTC-4 on 9 Mar 2025 (the change happens at 02:00).
  setDisplaySettings({ timeZone: 'America/New_York' });
  assert.equal(new Date(platformMidnight(2025, 3, 9)).toISOString(), '2025-03-09T05:00:00.000Z');
  assert.equal(new Date(platformMidnight(2025, 3, 10)).toISOString(), '2025-03-10T04:00:00.000Z');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionsFor, audienceText, emptyForm, formFrom, statusBadge, toBody, toLocalInput, validateAnnouncement } from './announcementRules.js';

const NOW = new Date('2026-10-30T10:00:00');
const DAY = 24 * 60 * 60 * 1000;
const valid = (changes = {}) => ({ ...emptyForm(NOW), title: 'Ramadan Kariim', body: 'Bil wanaagsan.', roles: ['STAFF'], ...changes });

test('a complete form is valid; title, message, audience and schools are required', () => {
  assert.deepEqual(validateAnnouncement(valid(), { now: NOW }), {});
  const errors = validateAnnouncement({ ...emptyForm(NOW), allSchools: false }, { now: NOW });
  assert.deepEqual(Object.keys(errors).sort(), ['body', 'roles', 'schoolIds', 'title']);
  assert.match(validateAnnouncement(valid({ title: 'x'.repeat(121) }), { now: NOW }).title, /At most 120/);
});

test('links and images must be https; times: no past schedule, expiry after publishing and within 90 days', () => {
  assert.ok(validateAnnouncement(valid({ linkUrl: 'http://example.com' }), { now: NOW }).linkUrl);
  assert.ok(validateAnnouncement(valid({ imageUrl: 'javascript:alert(1)' }), { now: NOW }).imageUrl);
  assert.deepEqual(validateAnnouncement(valid({ linkUrl: 'https://example.com/guide' }), { now: NOW }), {});
  assert.ok(validateAnnouncement(valid({ action: 'schedule', publishAt: toLocalInput(new Date(NOW.getTime() - 60_000)) }), { now: NOW }).publishAt);
  assert.ok(validateAnnouncement(valid({ expiresAt: toLocalInput(new Date(NOW.getTime() - 60_000)) }), { now: NOW }).expiresAt);
  assert.match(validateAnnouncement(valid({ expiresAt: toLocalInput(new Date(NOW.getTime() + 91 * DAY)) }), { now: NOW }).expiresAt, /90 days/);
  // A scheduled announcement's 90 days count from its publish time.
  const later = new Date(NOW.getTime() + 10 * DAY);
  assert.deepEqual(validateAnnouncement(valid({ action: 'schedule', publishAt: toLocalInput(later), expiresAt: toLocalInput(new Date(later.getTime() + 89 * DAY)) }), { now: NOW }), {});
});

test('the request body: trimmed text, null for empty links, school ids only when selected, ISO times', () => {
  const body = toBody(valid({ title: '  Cinwaan  ', allSchools: false, schools: [{ id: 's1', name: 'A', code: 'A' }], action: 'schedule' }), { create: true });
  assert.equal(body.title, 'Cinwaan');
  assert.deepEqual([body.imageUrl, body.linkUrl, body.schoolIds, body.action], [null, null, ['s1'], 'schedule']);
  assert.match(body.publishAt, /Z$/);
  const edit = toBody(valid(), { create: false });
  assert.ok(!('action' in edit) && !('publishAt' in edit));
  assert.deepEqual(edit.schoolIds, []);
});

test('display: status badges, audience text, actions per state, edit form from a saved announcement', () => {
  assert.deepEqual(statusBadge('scheduled'), { label: 'Scheduled', variant: 'info' });
  assert.equal(audienceText({ roles: ['MANAGER', 'OWNER'], allSchools: true, schools: [] }), 'School Owners, Managers · all schools');
  assert.equal(audienceText({ roles: ['STAFF'], allSchools: false, schools: [{}, {}] }), 'Staff · 2 schools');
  assert.deepEqual(actionsFor('draft'), { edit: true, publish: true, withdraw: true });
  assert.deepEqual(actionsFor('withdrawn'), { edit: false, publish: false, withdraw: false });
  assert.deepEqual(actionsFor('published'), { edit: true, publish: false, withdraw: true });
  const form = formFrom({ kind: 'GUIDE', title: 'T', body: 'B', imageUrl: null, linkUrl: null, roles: ['STAFF'], allSchools: true, schools: [], publishAt: null, expiresAt: '2026-11-05T10:00:00.000Z' });
  assert.deepEqual([form.imageUrl, form.action, form.publishAt], ['', null, '']);
});

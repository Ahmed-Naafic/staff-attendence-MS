import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLandingConfig } from './landingConfig.js';

test('landing config: no contact, socials or figures are shown until they are set', () => {
  const c = buildLandingConfig({});
  assert.equal(c.contactEmail, '');
  assert.equal(c.contactHref, '');
  assert.deepEqual(c.socials, []);
  assert.equal(c.verifiedStats, false);
  assert.deepEqual(c.stats.map((s) => s.value), ['7', '4', 'Web + Mobile', 'Multi-branch'], 'facts about the product, not invented numbers');
});

test('landing config: real values are used; invalid ones are ignored', () => {
  const c = buildLandingConfig({
    VITE_CONTACT_EMAIL: ' hello@edutrack.example ',
    VITE_SOCIAL_LINKEDIN: 'https://www.linkedin.com/company/edutrack',
    VITE_SOCIAL_X: 'not a url',
    VITE_STAT_SCHOOLS: '12',
    VITE_STAT_STUDENTS: '5,000',
    VITE_STAT_STAFF: '400',
  });
  assert.equal(c.contactEmail, 'hello@edutrack.example');
  assert.match(c.contactHref, /^mailto:hello@edutrack\.example\?subject=/);
  assert.deepEqual(c.socials.map((s) => s.key), ['linkedin']);
  assert.equal(c.verifiedStats, false, 'all four figures are needed');
  const full = buildLandingConfig({ VITE_STAT_SCHOOLS: '12', VITE_STAT_STUDENTS: '5,000', VITE_STAT_STAFF: '400', VITE_STAT_UPTIME: '99.9%' });
  assert.equal(full.verifiedStats, true);
  assert.deepEqual(full.stats.map((s) => s.label), ['Schools', 'Students', 'Staff Members', 'Uptime']);
  assert.equal(buildLandingConfig({ VITE_CONTACT_EMAIL: 'nope' }).contactEmail, '');
});

/*
 * Registration guard tests (approved rules): there is no public registration. Without a session no
 * request can create an account or a school: sign-up style paths do not exist (404) and the
 * creation endpoints require a signed-in SUPER_ADMIN (401 signed out, 403 for other roles).
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed (nothing should be).
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Registration tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex');
const EMAIL_SUFFIX = `-${tag}@test.edutrack.example`;
const CODE_PREFIX = `RG${tag.toUpperCase()}`;
const cookies = {};
const accountIds = [];
let server;
let base;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && { origin: ORIGIN }),
      ...(cookie && { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await response.arrayBuffer();
  return response.status;
}

// Everything a sign-up form might send: an account, a role, a school.
const signUpBody = (name) => ({
  name: `Sign-up ${name} ${tag}`,
  email: `test-signup-${name}${EMAIL_SUFFIX}`,
  password: `Sign-up-${randomBytes(9).toString('base64url')}`,
  phone: '+252 61 2345678',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  schoolName: `Sign-up School ${tag}`,
  code: `${CODE_PREFIX}-${name.toUpperCase().slice(0, 6)}`,
  address: 'Test Road 1',
  city: 'Garowe',
});

const createdUsers = () => prisma.user.count({ where: { email: { endsWith: EMAIL_SUFFIX }, id: { notIn: accountIds } } });
const createdSchools = () => prisma.school.count({ where: { OR: [{ code: { startsWith: CODE_PREFIX } }, { name: { contains: tag } }] } });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-reg-${role.toLowerCase()}${EMAIL_SUFFIX}`;
    const user = await prisma.user.create({ data: { name: `Registration ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    accountIds.push(user.id);
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200, `${role} sign-in`);
    cookies[role] = res.headers.get('set-cookie').split(';')[0];
  }
});

after(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: EMAIL_SUFFIX } }, select: { id: true } });
  const schools = await prisma.school.findMany({ where: { OR: [{ code: { startsWith: CODE_PREFIX } }, { name: { contains: tag } }] }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const schoolIds = schools.map((s) => s.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }, { schoolId: { in: schoolIds } }] } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('there is no public registration', () => {
  const SIGN_UP_PATHS = [
    '/api/register',
    '/api/signup',
    '/api/sign-up',
    '/api/auth/register',
    '/api/auth/signup',
    '/api/auth/sign-up',
    '/api/auth/users',
    '/api/users',
    '/api/accounts',
    '/api/owners',
    '/api/schools',
    '/api/schools/register',
    '/api/invitations',
  ];

  test('sign-up style paths do not exist (404), signed out or signed in, and create nothing', async () => {
    for (const path of SIGN_UP_PATHS) {
      for (const method of ['POST', 'PUT']) {
        assert.equal(await call(path, { method, body: signUpBody('public') }), 404, `${method} ${path} signed out`);
        assert.equal(await call(path, { method, body: signUpBody('public'), cookie: cookies.OWNER }), 404, `${method} ${path} as OWNER`);
      }
    }
    assert.equal(await createdUsers(), 0, 'no account created');
    assert.equal(await createdSchools(), 0, 'no school created');
  });

  test('the creation endpoints require a session: signed out → 401, nothing created', async () => {
    assert.equal(await call('/api/platform/owners', { method: 'POST', body: signUpBody('owner') }), 401);
    assert.equal(await call('/api/platform/schools', { method: 'POST', body: { ...signUpBody('school'), name: `Sign-up School ${tag}` } }), 401);
    assert.equal(await createdUsers(), 0);
    assert.equal(await createdSchools(), 0);
  });

  test('only a Super Admin creates schools and owners: other roles → 403, nothing created', async () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      assert.equal(await call('/api/platform/owners', { method: 'POST', body: signUpBody(role.toLowerCase()), cookie: cookies[role] }), 403, `owner as ${role}`);
      assert.equal(
        await call('/api/platform/schools', { method: 'POST', body: { ...signUpBody(role.toLowerCase()), name: `Sign-up School ${tag}` }, cookie: cookies[role] }),
        403,
        `school as ${role}`,
      );
    }
    assert.equal(await createdUsers(), 0);
    assert.equal(await createdSchools(), 0);
  });

  test('sign-in never creates an account for an unknown email', async () => {
    const email = `test-signup-login${EMAIL_SUFFIX}`;
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'user-agent': `EduTrackRegistrationTest/${tag}` },
      body: JSON.stringify({ email, password: 'a-password-long-enough' }),
    });
    assert.equal(res.status, 401);
    assert.equal(await prisma.user.count({ where: { email } }), 0);
    // Its failed sign-in event (no account, so no actor) is found by this test's user agent.
    await prisma.auditEvent.deleteMany({ where: { actorId: null, userAgent: `EduTrackRegistrationTest/${tag}` } });
  });
});

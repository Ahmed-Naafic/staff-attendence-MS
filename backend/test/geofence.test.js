/*
 * Attendance geofence tests (approved rules: docs/business-rules.md → GPS and geofence). Positions
 * are accepted only when usable, accurate to 50 m or better and at most 100 m from the branch
 * location in effect at the event's time; history is respected (a later or cancelled location never
 * applies). Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { getPrisma } from '../src/config/prisma.js';
import { checkBranchPosition, distanceMeters, GEOFENCE_RADIUS_M, judgePosition } from '../src/features/attendance/geofence.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Geofence tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const tag = randomBytes(3).toString('hex').toUpperCase();
/** Metres per degree of latitude on the mean-radius sphere. */
const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const BRANCH = { latitude: 2.046934, longitude: 45.318162 };
/** A point `metres` due north of `point`. */
const north = (point, metres) => ({ latitude: point.latitude + metres / M_PER_DEG, longitude: point.longitude });
const at = (point, metres, accuracy = 10) => ({ ...north(point, metres), accuracy });

describe('distance', () => {
  test('one degree of longitude on the equator is the mean-radius arc', () => {
    assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - M_PER_DEG) < 1e-6);
  });
  test('is symmetric and zero for the same point', () => {
    const other = { latitude: 2.0469, longitude: 45.3191 };
    assert.equal(distanceMeters(BRANCH, BRANCH), 0);
    assert.ok(Math.abs(distanceMeters(BRANCH, other) - distanceMeters(other, BRANCH)) < 1e-9);
  });
  test('short distances match a known offset to a centimetre', () => {
    assert.ok(Math.abs(distanceMeters(BRANCH, north(BRANCH, 75)) - 75) < 0.01);
  });
});

describe('judging a position', () => {
  test('inside the radius with good accuracy is accepted', () => {
    const result = judgePosition(at(BRANCH, 40), BRANCH);
    assert.equal(result.accepted, true);
    assert.equal(result.reason, null);
    assert.ok(Math.abs(result.distanceMeters - 40) < 0.01);
  });
  test('the 100 m radius is inclusive; just beyond is refused with the distance', () => {
    assert.equal(GEOFENCE_RADIUS_M, 100);
    assert.equal(judgePosition(at(BRANCH, 99.99), BRANCH).accepted, true);
    const outside = judgePosition(at(BRANCH, 100.01), BRANCH);
    assert.deepEqual([outside.accepted, outside.reason], [false, 'outside_geofence']);
    assert.ok(outside.distanceMeters > 100);
    assert.equal(judgePosition(at(BRANCH, 5000), BRANCH).reason, 'outside_geofence');
  });
  test('accuracy of exactly 50 m is accepted; worse is refused even at the branch', () => {
    assert.equal(judgePosition(at(BRANCH, 0, 50), BRANCH).accepted, true);
    assert.equal(judgePosition(at(BRANCH, 0, 50.1), BRANCH).reason, 'accuracy_too_low');
    assert.equal(judgePosition(at(BRANCH, 0, 120), BRANCH).reason, 'accuracy_too_low');
  });
  test('accuracy is not used to stretch the radius', () => {
    // 120 m away with ±30 m accuracy could be inside, but the rule judges the reported position.
    assert.equal(judgePosition(at(BRANCH, 120, 30), BRANCH).reason, 'outside_geofence');
  });
  test('missing or unusable positions are refused before distance is measured', () => {
    assert.equal(judgePosition(null, BRANCH).reason, 'no_position');
    assert.equal(judgePosition(undefined, BRANCH).reason, 'no_position');
    assert.equal(judgePosition({ latitude: 0, longitude: 0, accuracy: 5 }, BRANCH).reason, 'invalid_position');
    assert.equal(judgePosition({ latitude: 91, longitude: 45, accuracy: 5 }, BRANCH).reason, 'invalid_position');
    assert.equal(judgePosition({ latitude: 2, longitude: -181, accuracy: 5 }, BRANCH).reason, 'invalid_position');
    assert.equal(judgePosition({ latitude: '2.04', longitude: 45.3, accuracy: 5 }, BRANCH).reason, 'invalid_position');
    assert.equal(judgePosition({ ...BRANCH, accuracy: NaN }, BRANCH).reason, 'accuracy_too_low');
    assert.equal(judgePosition({ ...BRANCH }, BRANCH).reason, 'accuracy_too_low');
    assert.equal(judgePosition({ ...BRANCH, accuracy: 0 }, BRANCH).reason, 'accuracy_too_low');
  });
  test('no branch location in effect cannot accept anything', () => {
    assert.deepEqual(judgePosition(at(BRANCH, 0), null), { accepted: false, reason: 'no_branch_location', distanceMeters: null });
  });
});

describe('checking a position for a branch at an event time', () => {
  const t = (iso) => new Date(iso);
  const MOVED = north(BRANCH, 1000);
  let school;
  let branch;

  before(async () => {
    school = await prisma.school.create({ data: { code: `GEO-${tag}`, name: `Geofence ${tag}`, location: 'Test City' } });
    branch = await prisma.branch.create({
      data: { schoolId: school.id, number: 1, code: `GEO-${tag}-B001`, name: 'Geo', nameKey: 'geo', address: 'Test street', city: 'Test City' },
    });
    await prisma.branchLocation.createMany({
      data: [
        { branchId: branch.id, ...BRANCH, accuracyMeters: 8, effectiveFrom: t('2026-01-01T00:00:00Z') },
        // Cancelled before it took effect: never applies.
        { branchId: branch.id, ...north(BRANCH, 500), accuracyMeters: 8, effectiveFrom: t('2026-03-01T00:00:00Z'), cancelledAt: t('2026-02-15T00:00:00Z') },
        { branchId: branch.id, ...MOVED, accuracyMeters: 8, effectiveFrom: t('2026-06-01T00:00:00Z') },
      ],
    });
  });

  after(async () => {
    if (branch) {
      await prisma.branchLocation.deleteMany({ where: { branchId: branch.id } });
      await prisma.branch.deleteMany({ where: { id: branch.id } });
    }
    if (school) await prisma.school.deleteMany({ where: { id: school.id } });
  });

  test('uses the location in effect at the event time, ignoring later and cancelled ones', async () => {
    const before = await checkBranchPosition({ branchId: branch.id, position: at(BRANCH, 30), at: t('2026-04-01T08:00:00Z') });
    assert.equal(before.accepted, true);
    assert.equal(before.operating, true);
    // The old position is far from the new location once it is in effect…
    const afterMove = await checkBranchPosition({ branchId: branch.id, position: at(BRANCH, 30), at: t('2026-06-01T08:00:00Z') });
    assert.equal(afterMove.reason, 'outside_geofence');
    // …and the new position is judged against the old location for an event before the move (an offline event sent later).
    const late = await checkBranchPosition({ branchId: branch.id, position: at(MOVED, 10), at: t('2026-05-31T23:59:59Z') });
    assert.equal(late.reason, 'outside_geofence');
    assert.equal((await checkBranchPosition({ branchId: branch.id, position: at(MOVED, 10), at: t('2026-06-01T00:00:00Z') })).accepted, true);
    // The cancelled location never applied.
    assert.equal((await checkBranchPosition({ branchId: branch.id, position: at(north(BRANCH, 500), 0), at: t('2026-03-02T00:00:00Z') })).reason, 'outside_geofence');
  });

  test('before the first location there is no branch location', async () => {
    const result = await checkBranchPosition({ branchId: branch.id, position: at(BRANCH, 0), at: t('2025-12-31T23:59:59Z') });
    assert.deepEqual([result.accepted, result.reason, result.locationId], [false, 'no_branch_location', null]);
  });

  test('reports the operating state with the judgement', async () => {
    await prisma.branch.update({ where: { id: branch.id }, data: { status: 'SUSPENDED' } });
    await prisma.school.update({ where: { id: school.id }, data: { status: 'SUSPENDED' } });
    try {
      const result = await checkBranchPosition({ branchId: branch.id, position: at(BRANCH, 0), at: t('2026-04-01T00:00:00Z') });
      assert.equal(result.accepted, true);
      assert.equal(result.operating, false);
      assert.deepEqual(result.operatingReasons, ['branch_suspended', 'school_suspended']);
    } finally {
      await prisma.branch.update({ where: { id: branch.id }, data: { status: 'ACTIVE' } });
      await prisma.school.update({ where: { id: school.id }, data: { status: 'ACTIVE' } });
    }
  });

  test('an unknown branch is 404 and an invalid time is a programming error', async () => {
    await assert.rejects(checkBranchPosition({ branchId: '00000000-0000-0000-0000-000000000000', position: at(BRANCH, 0), at: new Date() }), { status: 404 });
    await assert.rejects(checkBranchPosition({ branchId: branch.id, position: at(BRANCH, 0), at: new Date('nope') }), TypeError);
    await assert.rejects(checkBranchPosition({ branchId: branch.id, position: at(BRANCH, 0), at: '2026-04-01' }), TypeError);
  });

  test('writes nothing', async () => {
    const count = () => prisma.branchLocation.count({ where: { branchId: branch.id } });
    const events = () => prisma.auditEvent.count({ where: { schoolId: school.id } });
    const [l, e] = [await count(), await events()];
    await checkBranchPosition({ branchId: branch.id, position: at(BRANCH, 0), at: new Date() });
    assert.deepEqual([await count(), await events()], [l, e]);
  });
});

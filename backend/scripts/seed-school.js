/*
 * Fills ONE existing school with consistent test data for the whole system, as if it had used
 * EduTrack since the previous academic year (see scripts/school-seed/*.js for what each part adds):
 *
 *   base        previous year (closed) with results and promotion; curricula; sections A/B of every
 *               class with ≥ 40 students; Managers, teachers and support staff; teaching; calendar;
 *               bell times, staff schedules and timetables from the previous year's start; settings
 *   staff       staff check-ins of both years
 *   attendance  student attendance of the current year (Managers every day, teachers the last week)
 *   exams       examination configuration, two completed tests with results, a planned mid-term, a draft
 *   fees        fee configuration, monthly and examination fees, discounts, dated payments, closings
 *
 *   node --env-file=.env.dev --env-file=.env.seed scripts/seed-school.js --school CPAS-001
 *   node --env-file=.env --env-file=.env.seed scripts/seed-school.js --school CPAS-001 --production
 *
 * Options: --steps base,staff,attendance,exams,fees (default: all, in that order).
 * Accounts it creates sign in with SEED_PASSWORD (backend/.env.seed, never committed).
 * Only adds: existing records of the school are never changed or deleted (apart from the branch
 * number counters and the feature switches). Every part can run again; what is there is kept.
 * Production (any database but the dev branch) needs --production.
 */
import { localDateTime } from '../src/common/zonedTime.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/features/auth/password.js';
import { getPrisma } from '../src/config/prisma.js';
import { seedStudentAttendance } from './school-seed/attendance.js';
import { seedBase, seedStaffAttendance } from './school-seed/base.js';
import { seedExamConfig, seedExamRuns } from './school-seed/exams.js';
import { seedFeeActivity, seedFeeConfig } from './school-seed/fees.js';
import { stopApi } from './school-seed/util.js';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined;
};
const code = option('school');
const steps = String(option('steps') ?? 'base,staff,attendance,exams,fees').split(',');
const password = process.env.SEED_PASSWORD;
const problems = [];
if (typeof code !== 'string') problems.push('Name the school: --school <code>.');
if (!password || password.length < MIN_PASSWORD_LENGTH) problems.push(`SEED_PASSWORD (backend/.env.seed) must have at least ${MIN_PASSWORD_LENGTH} characters.`);
if (process.env.EDUTRACK_DB_BRANCH !== 'dev' && !option('production')) problems.push('This is not the dev database: add --production to seed it.');
if (problems.length) {
  console.error(`Refusing to seed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const prisma = getPrisma();
const started = Date.now();
const log = (m) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${m}`);
try {
  const school = await prisma.school.findUnique({ where: { code } });
  if (!school) throw new Error(`No school with code ${code}.`);
  const settings = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
  const tz = settings?.timezone ?? 'Africa/Mogadishu';
  const now = new Date();
  const ctx = { school, tz, now, today: localDateTime(now, tz).date, password, passwordHash: await hashPassword(password) };
  log(`Seeding ${school.name} (${school.code}), today ${ctx.today}, steps: ${steps.join(', ')}`);
  const refresh = async () => Object.assign(ctx, { school: await prisma.school.findUnique({ where: { id: school.id } }) });
  if (steps.includes('base')) await seedBase(prisma, ctx, log);
  if (steps.includes('staff')) await seedStaffAttendance(prisma, ctx, log);
  if (steps.includes('attendance')) await seedStudentAttendance(prisma, ctx, log);
  if (steps.includes('exams')) {
    await refresh();
    await seedExamConfig(prisma, ctx, log);
  }
  if (steps.includes('fees')) {
    await refresh();
    await seedFeeConfig(prisma, ctx, log); // before examinations are scheduled: their fees get charged
  }
  if (steps.includes('exams')) await seedExamRuns(prisma, ctx, log);
  if (steps.includes('fees')) await seedFeeActivity(prisma, ctx, log);
  log('Done.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await stopApi(prisma).catch(() => {});
  await prisma.$disconnect();
}

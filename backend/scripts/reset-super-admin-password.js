/*
 * Resets a Super Admin's password (recovery; command line only — there is no web or API reset).
 *
 *   npm run reset-super-admin-password -- --email you@example.com            (production branch, backend/.env)
 *   npm run reset-super-admin-password:dev-branch -- --email you@example.com (Neon dev branch)
 *
 * Only an account with the SUPER_ADMIN role can be reset; any other email is refused with the same
 * message, and nothing changes. The operator confirms by typing RESET, then types the new password
 * twice at a hidden prompt. The password is never accepted as an argument or environment variable
 * (so it is not left in shell history or the process list), and the password and its hash are
 * never printed or logged. It is hashed with the platform's scrypt hashing (password.js).
 * The account's existing sessions are ended; its role and status are not changed.
 *
 * Each reset records a SUPER_ADMIN_PASSWORD_RESET security event (target account, host, operating-
 * system user, sessions ended; never the password or hash) in the same transaction as the change.
 * If the event cannot be written, the password is not changed and the command fails.
 *
 * Input is read from the terminal. When standard input is not a terminal (e.g. automated tests),
 * the same three lines are read from it instead.
 */
import { hostname, userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { getPrisma } from '../src/config/prisma.js';
import { MIN_PASSWORD_LENGTH } from '../src/features/auth/password.js';
import { findSuperAdmin, NotASuperAdminError, resetSuperAdminPassword } from '../src/features/auth/superAdminRecovery.js';

const CONFIRM_WORD = 'RESET';
const NOT_FOUND = 'No Super Admin account has this email. Nothing was changed.';

function fail(message) {
  console.error(message);
  process.exit(1);
}

let values;
try {
  ({ values } = parseArgs({ options: { email: { type: 'string' } } }));
} catch {
  // Unknown options (e.g. --password) are refused without echoing what was given.
  fail('Usage: reset-super-admin-password --email <super admin email>. The password is typed at a hidden prompt.');
}
const email = values.email?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Give the Super Admin account with --email.');

// One reader for every answer; typed characters are not echoed while `hidden` is set.
const input = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let hidden = false;
input._writeToOutput = (text) => {
  if (!hidden) input.output.write(text);
};
const lines = input[Symbol.asyncIterator]();

async function ask(question, { secret = false } = {}) {
  process.stdout.write(question);
  hidden = secret;
  const { value, done } = await lines.next();
  hidden = false;
  if (secret) process.stdout.write('\n');
  if (done) fail('Input ended. Nothing was changed.');
  return value;
}

const prisma = getPrisma();
const user = await findSuperAdmin(email);
if (!user) fail(NOT_FOUND);

const database = process.env.EDUTRACK_DB_BRANCH === 'dev' ? 'Neon dev branch' : 'production branch (backend/.env)';
console.log(`Super Admin: ${user.name} <${user.email}>`);
console.log(`Database: ${database}`);
if ((await ask(`Type ${CONFIRM_WORD} to reset this account's password: `)) !== CONFIRM_WORD) fail('Not confirmed. Nothing was changed.');

const password = await ask('New password (hidden): ', { secret: true });
if (password.length < MIN_PASSWORD_LENGTH) fail(`The password must have at least ${MIN_PASSWORD_LENGTH} characters. Nothing was changed.`);
if (!password.trim()) fail('The password cannot be only spaces. Nothing was changed.');
if ((await ask('Repeat the new password (hidden): ', { secret: true })) !== password) fail('The passwords do not match. Nothing was changed.');
input.close();

let osUser;
try {
  osUser = userInfo().username;
} catch {
  osUser = 'unknown';
}
let ended;
try {
  ({ sessionsEnded: ended } = await resetSuperAdminPassword(user.id, password, { tool: 'reset-super-admin-password', host: hostname(), osUser }));
} catch (error) {
  if (error instanceof NotASuperAdminError) fail(NOT_FOUND);
  // The change and its security audit record are one transaction: neither was written.
  fail('The password was NOT reset: the change or its security audit record could not be saved. Nothing was changed. Try again.');
}

console.log(`Password reset for ${user.email}. ${ended === 1 ? '1 session was' : `${ended} sessions were`} ended. A security audit event was recorded.`);
if (user.status !== 'ACTIVE') console.log('Note: this account is not active, so it still cannot sign in.');
await prisma.$disconnect();

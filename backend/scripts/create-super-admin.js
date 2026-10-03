/*
 * Creates a Super Admin account (the only way to create one).
 *
 *   npm run create-super-admin -- --email you@example.com --name "Your Name"            (production branch, backend/.env)
 *   npm run create-super-admin:dev-branch -- --email you@example.com --name "Your Name" (Neon dev branch)
 *
 * The password is read from the SUPER_ADMIN_PASSWORD environment variable or typed at a hidden
 * prompt. It is never printed or logged. An existing email is refused (nothing is overwritten).
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/features/auth/password.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => rl.output.write(text.startsWith(question) ? question : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Give a valid --email.');
if (!name) fail('Give a --name.');

const password = process.env.SUPER_ADMIN_PASSWORD ?? (await promptHidden('Password (hidden): '));
if (password.length < MIN_PASSWORD_LENGTH) fail(`The password must have at least ${MIN_PASSWORD_LENGTH} characters.`);

const prisma = getPrisma();
if (await prisma.user.findUnique({ where: { email } })) fail('An account with this email already exists. Nothing was changed.');

await prisma.user.create({
  data: { email, name, role: 'SUPER_ADMIN', status: 'ACTIVE', passwordHash: await hashPassword(password) },
});
console.log(`Super Admin account created for ${email}.`);
await prisma.$disconnect();

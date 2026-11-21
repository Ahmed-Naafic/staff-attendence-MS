import { randomInt } from 'node:crypto';
import { forbidden } from '../../common/httpError.js';
import { env } from '../../config/env.js';
import { getPrisma } from '../../config/prisma.js';
import { createStaff } from './staff.service.js';

/*
 * Sample staff for trying the system (Manager → Staff → Add Sample Staff): 20 staff members of the
 * Manager's branch, 15 teachers and 5 with other job titles. Each is created by createStaff, exactly
 * like a staff member added by hand (next Staff ID, active, the temporary password the Manager
 * chose, to change at first sign-in, audited STAFF_CREATED). Running it again adds only the missing
 * ones. Only where sample data is allowed (env.sampleData: the Neon dev branch, or SAMPLE_DATA=on);
 * never in production unless explicitly switched on.
 */

export const SAMPLE_STAFF = [
  { name: 'Abdirahman Mohamed Ali', jobTitle: 'Teacher' },
  { name: 'Fadumo Hassan Warsame', jobTitle: 'Teacher' },
  { name: 'Mohamed Abdi Farah', jobTitle: 'Teacher' },
  { name: 'Hodan Ahmed Yusuf', jobTitle: 'Teacher' },
  { name: 'Abdullahi Omar Nur', jobTitle: 'Teacher' },
  { name: 'Ifrah Abdullahi Jama', jobTitle: 'Teacher' },
  { name: 'Hassan Ibrahim Osman', jobTitle: 'Teacher' },
  { name: 'Sahra Mohamud Aden', jobTitle: 'Teacher' },
  { name: 'Yusuf Ali Hussein', jobTitle: 'Teacher' },
  { name: 'Amina Abdirashid Elmi', jobTitle: 'Teacher' },
  { name: 'Ahmed Said Mohamed', jobTitle: 'Teacher' },
  { name: 'Hibo Osman Abdi', jobTitle: 'Teacher' },
  { name: 'Mustafe Hussein Dahir', jobTitle: 'Teacher' },
  { name: 'Nasra Farah Ismail', jobTitle: 'Teacher' },
  { name: 'Abdiqani Yasin Hirsi', jobTitle: 'Teacher' },
  { name: 'Khadra Mohamed Barre', jobTitle: 'Accountant' },
  { name: 'Ayaan Abdi Guled', jobTitle: 'Secretary' },
  { name: 'Ismail Ahmed Warsame', jobTitle: 'Librarian' },
  { name: 'Abdikarim Nur Hassan', jobTitle: 'Security Guard' },
  { name: 'Faadumo Ali Shire', jobTitle: 'Cleaner' },
];

/** The sample staff member's email: how a sample staff member of a branch is recognised. */
export const sampleEmail = (branch, n) => `sample-staff-${String(n).padStart(2, '0')}.${branch.code.toLowerCase()}@example.com`;

/** Whether sample data can be added here, and how many of the branch's sample staff exist: { enabled, total, existing }. */
export async function sampleStaffStatus(branch) {
  const emails = SAMPLE_STAFF.map((_, i) => sampleEmail(branch, i + 1));
  const existing = env.sampleData ? await getPrisma().user.count({ where: { email: { in: emails } } }) : 0;
  return { enabled: env.sampleData, total: SAMPLE_STAFF.length, existing, teachers: SAMPLE_STAFF.filter((s) => s.jobTitle === 'Teacher').length };
}

/** A phone number for a sample staff member: +252 69 and 7 random digits (staff sign in with it). */
const samplePhone = () => `+252 69 ${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;

/** Creates the branch's missing sample staff with a temporary password → { created: [staff], skipped }. */
export async function createSampleStaff(branch, password, user, req) {
  if (!env.sampleData) throw forbidden('Sample staff can only be added on a test system.');
  const prisma = getPrisma();
  const emails = SAMPLE_STAFF.map((_, i) => sampleEmail(branch, i + 1));
  const have = new Set((await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((u) => u.email));
  const created = [];
  for (const [i, person] of SAMPLE_STAFF.entries()) {
    const email = emails[i];
    if (have.has(email)) continue;
    // A random phone can (rarely) be taken already: try another.
    for (let attempt = 1; ; attempt += 1) {
      try {
        created.push(await createStaff(branch, { name: person.name, jobTitle: person.jobTitle, email, phone: samplePhone(), password }, user, req));
        break;
      } catch (error) {
        if (error?.code !== 'PHONE_TAKEN' || attempt >= 5) throw error;
      }
    }
  }
  return { created, skipped: have.size };
}

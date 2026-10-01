/*
 * DEMO DATA — NOT REAL SCHOOL OWNERS.
 *
 * Built from the Schools demo set so both pages agree (one owner per school, same names,
 * cities and statuses: 28 owners, 25 active, 3 pending, 0 suspended). Both are replaced by
 * the real API in Phase 9; swap the source in loadOwners.js.
 *
 * Shape:
 * {
 *   isDemo, generatedAt,
 *   summary: { totalOwners, activeOwners, pendingOwners, suspendedOwners }
 *            each { changePercent, trend: number[] }   (counts come from `owners`)
 *   owners: [{
 *     id, name, email, phone, status, registeredAt, lastSignInAt | null,
 *     school: { id, name, location, registeredAt },
 *   }]
 * }
 * status: 'active' | 'pending' | 'suspended' (display only; rules not defined yet)
 */
import { createMockSchools } from '../../schools/data/mockSchools.js';

const HOUR = 60 * 60 * 1000;

// "Al-Noor Academy" → "alnoor"; "Somali Education Center" → "somali"
const domainOf = (schoolName) =>
  schoolName
    .replace(/\b(School|Academy|International|Center|Primary|Secondary|Hub)\b/g, '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const PREFIXES = ['61', '63', '90', '61', '62'];

export function createMockOwners({ now = new Date() } = {}) {
  const { schools } = createMockSchools({ now });

  const owners = schools.map((school, index) => {
    const firstName = school.ownerName.split(' ')[0].toLowerCase();
    const digits = String(1000000 + ((index * 7919 + 2345678) % 9000000)).slice(-7);
    return {
      id: school.id.replace('sch-', 'own-'),
      name: school.ownerName,
      email: `${firstName}@${domainOf(school.name)}.edu.so`,
      phone: `+252 ${PREFIXES[index % PREFIXES.length]} ${digits}`,
      status: school.status,
      // Owner accounts are listed from the day their school registered.
      registeredAt: school.registeredAt,
      lastSignInAt: school.status === 'active' ? new Date(now.getTime() - (2 + index * 5) * HOUR).toISOString() : null,
      school: { id: school.id, name: school.name, location: school.location, registeredAt: school.registeredAt },
    };
  });

  return {
    isDemo: true,
    generatedAt: now.toISOString(),
    summary: {
      totalOwners: { changePercent: 12, trend: [11, 13, 14, 16, 19, 21, 24, 28] },
      activeOwners: { changePercent: 19, trend: [10, 12, 13, 15, 17, 19, 21, 25] },
      pendingOwners: { changePercent: -25, trend: [3, 2, 4, 3, 4, 3, 4, 3] },
      suspendedOwners: { changePercent: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] },
    },
    owners,
  };
}

/** Same shape with no owners — used to preview the empty state. */
export function createEmptyMockOwners({ now = new Date() } = {}) {
  const zero = { changePercent: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] };
  return {
    isDemo: true,
    generatedAt: now.toISOString(),
    summary: { totalOwners: zero, activeOwners: zero, pendingOwners: zero, suspendedOwners: zero },
    owners: [],
  };
}

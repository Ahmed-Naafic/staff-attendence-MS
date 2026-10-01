/*
 * DEMO DATA — NOT REAL SCHOOLS.
 *
 * Shapes the Schools list response so the page can be built before the backend exists.
 * Figures agree with the dashboard demo data (28 schools: 25 active, 3 pending, 0 suspended).
 * Replace the source in loadSchools.js with the real API in Phase 9.
 *
 * Shape:
 * {
 *   isDemo, generatedAt,
 *   summary: { totalSchools, activeSchools, pendingSchools, suspendedSchools }
 *            each { changePercent, trend: number[] }   (counts come from `schools`)
 *   schools: [{ id, code, name, ownerName, location, status, registeredAt, description }]
 * }
 * status: 'active' | 'pending' | 'suspended' (display only; rules not defined yet)
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// [name, owner, location, status, registered (ms ago)] — newest first.
const rows = [
  ['Bright Future School', 'Ayaan Ali', 'Kismayo', 'pending', 2 * HOUR],
  ['Sunrise School', 'Hassan Mohamed', 'Baidoa', 'active', 3 * DAY],
  ['Somali Education Center', 'Khadija Osman', 'Garowe', 'active', 5 * DAY],
  ['Horizon International', 'Omar Hassan', 'Hargeisa', 'active', 9 * DAY],
  ['Al-Noor Academy', 'Fatima Ahmed', 'Mogadishu', 'active', 12 * DAY],
  ['Vision School', 'Ayan Ahmed', 'Hargeisa', 'pending', 18 * DAY],
  ['Unity School', 'Mohamed Yusuf', 'Mogadishu', 'active', 26 * DAY],
  ['Knowledge Hub', 'Zahra Ibrahim', 'Hargeisa', 'active', 34 * DAY],
  ['Future Leaders Academy', 'Ali Mohamed', 'Kismayo', 'active', 41 * DAY],
  ['Hope International', 'Khadija Hassan', 'Mogadishu', 'pending', 47 * DAY],
  ['Al-Huda Academy', 'Mohamed Ali', 'Mogadishu', 'active', 58 * DAY],
  ['Golis Academy', 'Omar Osman', 'Garowe', 'active', 66 * DAY],
  ['Iftin Primary School', 'Hodan Abdi', 'Mogadishu', 'active', 79 * DAY],
  ['Hiil Academy', 'Abdirahman Farah', 'Baidoa', 'active', 95 * DAY],
  ['Daryeel School', 'Sahra Warsame', 'Mogadishu', 'active', 112 * DAY],
  ['Nabad Secondary School', 'Yusuf Aden', 'Kismayo', 'active', 128 * DAY],
  ['Mandeeq Academy', 'Faadumo Jama', 'Hargeisa', 'active', 151 * DAY],
  ['Sahan School', 'Ibrahim Nur', 'Mogadishu', 'active', 173 * DAY],
  ['Raadin Academy', 'Amina Hussein', 'Garowe', 'active', 196 * DAY],
  ['Ilays School', 'Abdullahi Said', 'Mogadishu', 'active', 218 * DAY],
  ['Barwaaqo School', 'Maryan Elmi', 'Baidoa', 'active', 240 * DAY],
  ['Hodan School', 'Hamza Ismail', 'Mogadishu', 'active', 262 * DAY],
  ['Midnimo Academy', 'Asha Gedi', 'Kismayo', 'active', 284 * DAY],
  ['Horseed School', 'Bashir Abdi', 'Hargeisa', 'active', 300 * DAY],
  ['Waaberi School', 'Nimco Yasin', 'Mogadishu', 'active', 318 * DAY],
  ['Dalsan Academy', 'Liban Hirsi', 'Garowe', 'active', 334 * DAY],
  ['Shabelle School', 'Hibo Mahad', 'Mogadishu', 'active', 347 * DAY],
  ['Jamhuuriya School', 'Said Barre', 'Mogadishu', 'active', 359 * DAY],
];

export function createMockSchools({ now = new Date() } = {}) {
  const total = rows.length;
  const schools = rows.map(([name, ownerName, location, status, msAgo], index) => {
    const registeredAt = new Date(now.getTime() - msAgo);
    const sequence = String(total - index).padStart(3, '0');
    return {
      id: `sch-${sequence}`,
      code: `SCL-${registeredAt.getFullYear()}-${sequence}`,
      name,
      ownerName,
      location,
      status,
      registeredAt: registeredAt.toISOString(),
      description: `${name} is a school in ${location}, Somalia.`,
    };
  });

  return {
    isDemo: true,
    generatedAt: now.toISOString(),
    summary: {
      totalSchools: { changePercent: 12, trend: [14, 16, 19, 21, 24, 25, 26, 28] },
      activeSchools: { changePercent: 19, trend: [10, 12, 13, 15, 17, 19, 21, 25] },
      pendingSchools: { changePercent: -25, trend: [3, 2, 4, 3, 4, 3, 4, 3] },
      suspendedSchools: { changePercent: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] },
    },
    schools,
  };
}

/** Same shape with no schools — used to preview the empty state. */
export function createEmptyMockSchools({ now = new Date() } = {}) {
  const zero = { changePercent: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] };
  return {
    isDemo: true,
    generatedAt: now.toISOString(),
    summary: { totalSchools: zero, activeSchools: zero, pendingSchools: zero, suspendedSchools: zero },
    schools: [],
  };
}

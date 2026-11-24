/*
 * DEV BRANCH ONLY — Fee Management sample data for the demo school (the dev Owner's school):
 *
 *   configuration  the module switched on; a monthly fee per class (by class order), examination fees
 *                  per class and examination type, receipt design, discount and scholarship policies;
 *   accountants    one Accountant per active branch (accountant.b<n>@edutrack.example, the dev
 *                  Owner's password from .env.dev, no password change needed);
 *   activity       monthly fees generated for every enrolled student; discounts given to a few;
 *                  cash payments by each branch's Accountant (most students paid up, some partly, some
 *                  not at all) with receipts; one reversal; bulk invoices for one section per branch;
 *                  each Accountant's cash closed (one with a small shortage).
 *
 *   npm run seed:dev-fees --workspace backend     (also run by `npm run seed:dev`)
 *
 * Everything goes through the API (in-process, like the tests), so every rule applies. The only
 * direct writes: the module switch (a Super Admin switch) and the seeded Accountants' "change your
 * password" flag. Safe to run again: configuration that exists is kept; payments, invoices and
 * closings are added only when the school has no payments yet. Refuses to run unless
 * EDUTRACK_DB_BRANCH is "dev".
 */
import { OWNER_EMAIL } from './accounts.js';

const ORIGIN = 'http://localhost:5173';

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function startServer() {
  const { default: app } = await import('../../src/app.js');
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** A signed-in client of the in-process API for one account. */
async function client(base, email, password, prefix) {
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`${email} could not sign in (${login.status}).`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  return async (path, { method = 'GET', body, query } = {}) => {
    const url = new URL(`${base}/api/${prefix}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const response = await fetch(url, { method, headers: { cookie, ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    const data = text && (response.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${data?.error ?? text.slice(0, 200)}`);
    return data;
  };
}

/** Monthly fee by class order: lower classes pay less. */
const monthlyFeeFor = (sequence) => (sequence <= 2 ? 1500 : sequence <= 4 ? 2000 : sequence <= 6 ? 2500 : 3000);
const EXAM_FEES = { 'monthly test': 300, 'mid-term': 800, 'end of term': 1200 };
const POLICIES = [
  { name: 'Sibling discount', category: 'discount', type: 'percentage', value: 1000, appliesTo: ['monthly'], eligibility: 'Second and further children of a family in the school.', combinable: true, managersAssign: true },
  { name: 'Merit award', category: 'discount', type: 'fixed', value: 500, appliesTo: ['monthly'], eligibility: 'Top three of a class in the last examination.', combinable: true, managersAssign: true, maxStudents: 30 },
  { name: 'Partial scholarship', category: 'scholarship', type: 'percentage', value: 5000, appliesTo: ['monthly', 'exam'], eligibility: 'Families in hardship, approved by the School Owner.', combinable: false, managersAssign: false },
  { name: 'Full scholarship', category: 'scholarship', type: 'percentage', value: 10000, appliesTo: ['monthly', 'exam'], eligibility: 'Orphans and exceptional cases.', combinable: false, managersAssign: false },
];

export async function seedFees(prisma, log = console.log) {
  const password = process.env.DEV_OWNER_PASSWORD;
  if (!password) throw new Error('DEV_OWNER_PASSWORD is not set in backend/.env.dev.');
  const ownerUser = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  const school = ownerUser && (await prisma.school.findUnique({ where: { ownerId: ownerUser.id } }));
  if (!school) {
    log('Fee Management: no demo school; run seed:dev-accounts first.');
    return;
  }
  log('Fee Management: configuration');
  if (!school.feesEnabled) {
    await prisma.school.update({ where: { id: school.id }, data: { feesEnabled: true } });
    log('  + Fee Management switched on for the school');
  }
  const { server, base } = await startServer();
  try {
    const owner = await client(base, OWNER_EMAIL, password, 'owner/fees');
    const status = await owner('/status');
    const structures = await owner('/structures');
    if (!structures.academicYear) {
      log('  · no current academic year: nothing to charge');
      return;
    }
    // Monthly fees per class.
    const classes = await prisma.schoolClass.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { sequence: 'asc' } });
    for (const c of classes) {
      if (structures.items.some((s) => s.class.id === c.id)) continue;
      await owner('/structures', { method: 'POST', body: { class: c.id, monthlyFee: monthlyFeeFor(c.sequence) } });
      log(`  + monthly fee ${c.name}: $${monthlyFeeFor(c.sequence) / 100}`);
    }
    // Examination fees.
    const examFees = await owner('/exam-fees');
    const rates = [];
    for (const c of examFees.classes) for (const t of examFees.examTypes) {
      const amount = EXAM_FEES[t.name.toLowerCase()] ?? 500;
      if (!examFees.rates.some((r) => r.classId === c.id && r.examTypeId === t.id)) rates.push({ class: c.id, examType: t.id, amount });
    }
    if (rates.length) {
      await owner('/exam-fees', { method: 'PUT', body: { rates } });
      log(`  + examination fees (${rates.length})`);
    }
    // Receipt and invoice design.
    const branding = await owner('/branding');
    if (!branding.branding.id) {
      await owner('/branding', { method: 'PUT', body: { schoolName: school.name, address: school.address ?? 'Mogadishu', phone: school.phone ?? null, email: school.email ?? null, footer: 'Thank you for your payment. Keep this receipt.', signatureLabel: 'Cashier signature', showSignature: true } });
      log('  + receipt and invoice design');
    }
    // Discount policies.
    const policies = await owner('/discount-policies');
    for (const p of POLICIES) {
      if (policies.items.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) continue;
      await owner('/discount-policies', { method: 'POST', body: p });
      log(`  + policy ${p.name}`);
    }
    // Accountants.
    log('Fee Management: Accountants');
    const accountants = await owner('/accountants');
    const branches = status.branches.filter((b) => b.status === 'active');
    for (const b of branches) {
      const email = `accountant.b${String(branches.indexOf(b) + 1)}@edutrack.example`;
      let a = accountants.items.find((x) => x.email === email);
      if (!a) {
        a = (await owner('/accountants', { method: 'POST', body: { name: `${['Hodan', 'Abdirahman', 'Sahra', 'Mohamed'][branches.indexOf(b) % 4]} Accountant`, email, phone: `+252 61 40000${branches.indexOf(b) + 1}`, branchId: b.id, password } })).accountant;
        log(`  + ${a.name} (${email}) for ${b.name}`);
      }
      await prisma.user.update({ where: { id: a.id }, data: { mustChangePassword: false } });
    }

    // Activity, once.
    if (await prisma.feePayment.count({ where: { schoolId: school.id } })) {
      log('Fee Management: payments already exist; activity left as it is');
      return;
    }
    log('Fee Management: activity');
    await owner('/generation/run', { method: 'POST', body: {} });
    const pick = rngFrom(20261123);
    // Discounts: a few students of each branch.
    const all = await owner('/students', { query: { pageSize: 100 } });
    const pool = all.items.filter((r) => r.totals.count > 0);
    const freshPolicies = (await owner('/discount-policies')).items;
    const policyId = (name) => freshPolicies.find((p) => p.name === name)?.id;
    const firstMonth = structures.months[0].value;
    const given = [];
    for (const [i, r] of pool.slice(0, 8).entries()) {
      const name = i < 4 ? 'Sibling discount' : i < 6 ? 'Merit award' : i === 6 ? 'Partial scholarship' : 'Full scholarship';
      try {
        await owner('/student-discounts', { method: 'POST', body: { student: r.student.id, policy: policyId(name), startMonth: firstMonth, reason: name === 'Merit award' ? 'Top of the class in the Monthly Test.' : name.includes('scholarship') ? 'Approved by the School Owner.' : 'Has a brother in the school.', applyToOpen: true } });
        given.push(r.student.name);
      } catch (e) {
        log(`  ! discount for ${r.student.name}: ${e.message}`);
      }
    }
    log(`  + discounts given to ${given.length} students`);
    // Payments by each branch's Accountant.
    let paid = 0;
    let payments = 0;
    for (const b of branches) {
      const email = `accountant.b${branches.indexOf(b) + 1}@edutrack.example`;
      const acc = await client(base, email, password, 'accountant/fees');
      const list = await acc('/students', { query: { pageSize: 100 } });
      for (const r of list.items) {
        const roll = pick();
        if (roll > 0.82) continue; // owes everything
        const payable = await acc(`/students/${r.student.id}/payable`);
        let items = payable.items.filter((o) => o.kind === 'monthly');
        if (!items.length) continue;
        if (roll > 0.6) items = items.slice(0, Math.max(1, items.length - 1)); // leaves the latest month unpaid
        const partialLast = roll > 0.5 && roll <= 0.6;
        const allocations = items.map((o, i) => ({ obligation: o.id, amount: partialLast && i === items.length - 1 ? Math.max(100, Math.round(o.balance / 2 / 100) * 100) : o.balance }));
        const amount = allocations.reduce((n, a) => n + a.amount, 0);
        // Older months paid first in one payment, the rest in a second, like a parent paying twice.
        const split = allocations.length > 2 && pick() < 0.4 ? 2 : allocations.length;
        for (const part of [allocations.slice(0, split), allocations.slice(split)]) {
          if (!part.length) continue;
          await acc('/payments', { method: 'POST', body: { student: r.student.id, amount: part.reduce((n, a) => n + a.amount, 0), allocations: part, requestKey: crypto.randomUUID() } });
          payments += 1;
        }
        paid += amount;
      }
      // Examination fees of the planned examination: about half paid.
      const fees = await prisma.feeObligation.findMany({ where: { schoolId: school.id, kind: 'EXAM', status: 'OPEN', student: { branchId: b.id } }, take: 200 });
      for (const f of fees) {
        if (pick() < 0.5) continue;
        await acc('/payments', { method: 'POST', body: { student: f.studentId, amount: f.netAmount - f.paidAmount, allocations: [{ obligation: f.id, amount: f.netAmount - f.paidAmount }], requestKey: crypto.randomUUID() } });
        payments += 1;
        paid += f.netAmount - f.paidAmount;
      }
      // Bulk invoices for the first section with students.
      const section = status.sections.find((s) => s.branchId === b.id);
      if (section) {
        const bulk = await acc('/invoices/bulk', { method: 'POST', body: { section: section.id } });
        log(`  + ${bulk.created} invoices for a section of ${b.name}`);
      }
    }
    log(`  + ${payments} cash payments ($${(paid / 100).toLocaleString('en-US')}) with receipts`);
    // One reversal (a payment recorded twice by mistake), by the School Owner.
    const latest = await owner('/payments', { query: { pageSize: 5 } });
    if (latest.items[0]) {
      await owner(`/payments/${latest.items[0].id}/reverse`, { method: 'POST', body: { reason: 'Recorded twice by mistake.' } });
      log(`  + payment ${latest.items[0].receipt.number} reversed (receipt void)`);
    }
    // Each Accountant closes their cash; the first with a small shortage.
    for (const [i, b] of branches.entries()) {
      const acc = await client(base, `accountant.b${i + 1}@edutrack.example`, password, 'accountant/fees');
      const mine = await acc('/closings/mine');
      const short = i === 0 && mine.open.expectedAmount >= 500 ? 500 : 0;
      await acc('/closings', { method: 'POST', body: { counted: mine.open.expectedAmount - short, expected: mine.open.expectedAmount, explanation: short ? 'Change given wrongly to a parent; to be followed up.' : null } });
      log(`  + ${b.name}: cash closed (${short ? 'shortage $5' : 'balanced'})`);
    }
  } finally {
    server.close();
  }
}

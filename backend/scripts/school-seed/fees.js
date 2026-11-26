/*
 * School seed, part 4 — Fee Management of the current year, through the API:
 *
 *   configuration (before examinations are scheduled, so their fees are charged)
 *     monthly fee per class (classes that already have a structure keep it), examination fees per
 *     class and type, receipt design, discount and scholarship policies, one Accountant per branch
 *     (accountant.b<n>@<school code>.seed.example, the seed password);
 *   activity (once: when the school has no payments yet)
 *     monthly fees generated for every month of the year so far; discounts for a few students;
 *     cash payments by each branch's Accountant — most families up to date, some a month behind,
 *     some paying part, some nothing — dated in the month they paid (receipts too); examination
 *     fees about two-thirds paid; one reversal; bulk invoices; each Accountant's cash closed.
 *
 * Direct writes: the module switch, the seeded Accountants' "change your password" flag, and the
 * payment dates (the API records payments at the moment they are made).
 */
import { calendarToday } from '../../src/features/academic-calendar/calendar.service.js';
import { zonedInstant } from '../../src/common/zonedTime.js';
import { addDays, apiAs, iso, rngFrom } from './util.js';

const monthlyFeeFor = (cls) => (/^grade/i.test(cls.name) ? (cls.sequence <= 3 ? 1000 : cls.sequence <= 6 ? 1200 : 1500) : cls.sequence <= 10 ? 2000 : 2500);
const EXAM_FEES = { 'monthly test': 200, 'mid-term': 500, 'end of term': 800 };
const POLICIES = [
  { name: 'Sibling discount', category: 'discount', type: 'percentage', value: 1000, appliesTo: ['monthly'], eligibility: 'Second and further children of a family in the school.', combinable: true, managersAssign: true },
  { name: 'Merit award', category: 'discount', type: 'fixed', value: 300, appliesTo: ['monthly'], eligibility: 'Top three of a class in the last examination.', combinable: true, managersAssign: true, maxStudents: 40 },
  { name: 'Staff child', category: 'discount', type: 'percentage', value: 5000, appliesTo: ['monthly'], eligibility: 'Children of the school’s staff.', combinable: false, managersAssign: false },
  { name: 'Partial scholarship', category: 'scholarship', type: 'percentage', value: 5000, appliesTo: ['monthly', 'exam'], eligibility: 'Families in hardship, approved by the School Owner.', combinable: false, managersAssign: false },
  { name: 'Full scholarship', category: 'scholarship', type: 'percentage', value: 10000, appliesTo: ['monthly', 'exam'], eligibility: 'Orphans and exceptional cases.', combinable: false, managersAssign: false },
];
const accountantEmail = (school, b) => `accountant.b${b.number}@${school.code.toLowerCase()}.seed.example`;

export async function seedFeeConfig(prisma, { school, password }, log) {
  if (!school.feesEnabled) {
    await prisma.school.update({ where: { id: school.id }, data: { feesEnabled: true } });
    log('Fee Management: switched on.');
  }
  const owner = await prisma.user.findUnique({ where: { id: school.ownerId } });
  const call = await apiAs(owner, 'owner/fees');
  log('Fee Management: configuration');
  const structures = await call('/structures');
  if (!structures.academicYear) return log('  · no current academic year');
  const classes = await prisma.schoolClass.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { sequence: 'asc' } });
  let added = 0;
  for (const c of classes) {
    if (structures.items.some((s) => s.class.id === c.id)) continue;
    await call('/structures', { method: 'POST', body: { class: c.id, monthlyFee: monthlyFeeFor(c) } });
    added += 1;
  }
  if (added) log(`  + monthly fees for ${added} classes`);
  const examFees = await call('/exam-fees');
  const rates = [];
  for (const c of examFees.classes) for (const t of examFees.examTypes) if (!examFees.rates.some((r) => r.classId === c.id && r.examTypeId === t.id)) rates.push({ class: c.id, examType: t.id, amount: EXAM_FEES[t.name.toLowerCase()] ?? 300 });
  if (rates.length) {
    await call('/exam-fees', { method: 'PUT', body: { rates } });
    log(`  + examination fees (${rates.length})`);
  }
  const branding = await call('/branding');
  if (!branding.branding.id) {
    await call('/branding', { method: 'PUT', body: { schoolName: school.name, address: school.address ?? 'Mogadishu', phone: school.phone ?? null, email: school.email ?? null, footer: 'Thank you for your payment. Keep this receipt.', signatureLabel: 'Cashier signature', showSignature: true } });
    log('  + receipt and invoice design');
  }
  const policies = await call('/discount-policies');
  for (const p of POLICIES) {
    if (policies.items.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) continue;
    await call('/discount-policies', { method: 'POST', body: p });
    log(`  + policy ${p.name}`);
  }
  const accountants = await call('/accountants');
  const branches = await prisma.branch.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { number: 'asc' } });
  for (const [i, b] of branches.entries()) {
    const email = accountantEmail(school, b);
    let a = accountants.items.find((x) => x.email === email);
    if (!a) {
      a = (await call('/accountants', { method: 'POST', body: { name: ['Hodan Cali Warsame', 'Cabdiraxmaan Nuur Shire', 'Sahra Maxamed Jaamac', 'Mahad Cumar Faarax'][i % 4], email, phone: `+252 61 97${String(i + 1).padStart(5, '0')}`, branchId: b.id, password } })).accountant;
      log(`  + Accountant ${a.name} (${email}) for ${b.name}`);
    }
    await prisma.user.update({ where: { id: a.id }, data: { mustChangePassword: false } });
  }
}

export async function seedFeeActivity(prisma, { school, tz }, log) {
  // Resumable: each part checks what an earlier (interrupted) run left.
  if (await prisma.cashClosing.count({ where: { schoolId: school.id } })) return log('Fee Management: cash already closed; activity left as it is.');
  const resumed = (await prisma.studentDiscount.count({ where: { schoolId: school.id } })) > 0;
  const owner = await prisma.user.findUnique({ where: { id: school.ownerId } });
  const call = await apiAs(owner, 'owner/fees');
  const rng = rngFrom(20261126);
  const today = await calendarToday();
  log('Fee Management: activity');
  const structures = await call('/structures');
  if (!resumed) {
  for (const m of structures.months.map((x) => x.value).filter((m) => `${m}-01` <= today)) {
    try {
      await call('/generation/run', { method: 'POST', body: { month: m } });
    } catch (e) {
      log(`  · generation ${m}: ${e.message}`);
    }
  }
  const charged = await prisma.feeObligation.count({ where: { schoolId: school.id, kind: 'MONTHLY' } });
  log(`  + monthly fees generated (${charged})`);

  // Discounts for a few students (before payments, applied to open months).
  const policies = (await call('/discount-policies')).items;
  const policyId = (name) => policies.find((p) => p.name === name)?.id;
  const enrolled = await prisma.enrollment.findMany({ where: { schoolId: school.id, status: 'ACTIVE', academicYear: { status: 'CURRENT' } }, select: { studentId: true } });
  const firstMonth = structures.months[0].value;
  const plan = [...Array(12).fill('Sibling discount'), ...Array(5).fill('Merit award'), 'Staff child', 'Staff child', 'Partial scholarship', 'Partial scholarship', 'Partial scholarship', 'Full scholarship', 'Full scholarship'];
  let given = 0;
  for (const [i, name] of plan.entries()) {
    const student = enrolled[(i * 53 + 7) % enrolled.length].studentId;
    try {
      await call('/student-discounts', { method: 'POST', body: { student, policy: policyId(name), startMonth: firstMonth, reason: name === 'Merit award' ? 'Top of the class in the Monthly Test.' : name.includes('scholarship') ? 'Approved by the School Owner.' : name === 'Staff child' ? 'Parent works at the school.' : 'Has a brother in the school.', applyToOpen: true } });
      given += 1;
    } catch (e) {
      log(`  ! discount: ${e.message}`);
    }
  }
  log(`  + discounts for ${given} students`);
  }

  // Payments, branch by branch, by its Accountant; each dated in the month it was paid.
  const branches = await prisma.branch.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { number: 'asc' } });
  const alreadyPaid = new Set((await prisma.feePayment.groupBy({ by: ['studentId'], where: { schoolId: school.id } })).map((x) => x.studentId));
  let count = 0;
  let total = 0;
  const randomDayIn = (month, latest) => {
    const start = month > `${today.slice(0, 7)}` ? today : `${month}-01`;
    const last = [addDays(`${month}-01`, 27), latest].sort()[0];
    const span = Math.max(0, (Date.parse(last) - Date.parse(start)) / 86_400_000);
    return addDays(start, Math.floor(rng() * (span + 1)));
  };
  for (const b of branches) {
    const accountant = await prisma.user.findFirst({ where: { role: 'ACCOUNTANT', branchId: b.id, email: { endsWith: '.seed.example' } } });
    if (!accountant) continue;
    const acc = await apiAs(accountant, 'accountant/fees');
    const students = await prisma.enrollment.findMany({ where: { branchId: b.id, status: 'ACTIVE', academicYear: { status: 'CURRENT' } }, select: { studentId: true } });
    for (const { studentId } of students) {
      const roll = rng();
      if (alreadyPaid.has(studentId)) continue;
      if (roll > 0.9) continue; // owes everything
      const payable = await acc(`/students/${studentId}/payable`);
      let items = payable.items.filter((o) => o.kind === 'monthly').sort((x, y) => (x.month ?? '').localeCompare(y.month ?? ''));
      if (!items.length) continue;
      if (roll > 0.7) items = items.slice(0, Math.max(1, items.length - 1)); // a month behind
      const partial = roll > 0.62 && roll <= 0.7;
      // One payment per month (parents pay monthly), the last maybe only in part.
      for (const [i, o] of items.entries()) {
        const amount = partial && i === items.length - 1 ? Math.max(100, Math.round(o.balance / 2 / 100) * 100) : o.balance;
        if (amount <= 0) continue;
        const requestKey = crypto.randomUUID(); // the same on a retry: never recorded twice
        const { payment } = await acc('/payments', { method: 'POST', body: { student: studentId, amount, allocations: [{ obligation: o.id, amount }], requestKey } });
        count += 1;
        total += amount;
      }
      // Examination fees: about two-thirds paid.
      for (const o of payable.items.filter((x) => x.kind === 'exam')) {
        if (rng() < 0.33 || o.balance <= 0) continue;
        const requestKey = crypto.randomUUID();
        const { payment } = await acc('/payments', { method: 'POST', body: { student: studentId, amount: o.balance, allocations: [{ obligation: o.id, amount: o.balance }], requestKey } });
        count += 1;
        total += o.balance;
      }
    }
    // Bulk invoices for the first section of the branch.
    const section = await prisma.section.findFirst({ where: { branchId: b.id, academicYear: { status: 'CURRENT' } }, orderBy: { createdAt: 'asc' } });
    if (section && !(await prisma.feeInvoice.count({ where: { schoolId: school.id, branchId: b.id } }))) {
      const bulk = await acc('/invoices/bulk', { method: 'POST', body: { section: section.id } });
      log(`  + ${bulk.created} invoices for a section of ${b.name}`);
    }
  }
  // Payment dates: in the month paid, during office hours.
  // Every seed payment not dated yet (this run's and an interrupted run's): in the month it pays for.
  const accountantIds = (await prisma.user.findMany({ where: { role: 'ACCOUNTANT', email: { endsWith: '.seed.example' }, branch: { schoolId: school.id } }, select: { id: true } })).map((u) => u.id);
  const undated = await prisma.feePayment.findMany({ where: { schoolId: school.id, recordedById: { in: accountantIds }, receivedAt: { gte: zonedInstant(addDays(today, -1), 0, tz) } }, select: { id: true, allocations: { select: { obligation: { select: { kind: true, billingMonth: true } } } } } });
  const dated = undated.map((p) => {
    const o = p.allocations[0]?.obligation;
    return o?.kind === 'MONTHLY' && o.billingMonth ? { paymentId: p.id, day: randomDayIn(iso(o.billingMonth).slice(0, 7), addDays(today, -1)) } : { paymentId: p.id, day: randomDayIn(today.slice(0, 7), today) };
  });
  for (const d of dated) {
    const at = zonedInstant(d.day, 450 + Math.floor(rng() * 420), tz);
    if (at > new Date()) continue;
    const receipt = await prisma.feeReceipt.findUnique({ where: { paymentId: d.paymentId } });
    await prisma.feePayment.update({ where: { id: d.paymentId }, data: { receivedAt: at, createdAt: at } });
    if (receipt) await prisma.feeReceipt.update({ where: { id: receipt.id }, data: { issuedAt: at, content: { ...receipt.content, payment: { ...(receipt.content?.payment ?? {}), receivedAt: at.toISOString() } } } });
  }
  log(`  + ${count} cash payments ($${(total / 100).toLocaleString('en-US')}) with receipts, dated ${dated.length ? [...dated].sort((a, b) => a.day.localeCompare(b.day))[0].day : '-'} to ${today}`);

  const latest = await call('/payments', { query: { pageSize: 5 } });
  if (latest.items[0] && !(await prisma.feePayment.count({ where: { schoolId: school.id, status: { not: 'RECORDED' } } }))) {
    await call(`/payments/${latest.items[0].id}/reverse`, { method: 'POST', body: { reason: 'Recorded twice by mistake.' } });
    log(`  + payment ${latest.items[0].receipt?.number ?? ''} reversed`);
  }
  for (const [i, b] of branches.entries()) {
    const accountant = await prisma.user.findFirst({ where: { role: 'ACCOUNTANT', branchId: b.id, email: { endsWith: '.seed.example' } } });
    if (!accountant) continue;
    const acc = await apiAs(accountant, 'accountant/fees');
    const mine = await acc('/closings/mine');
    const short = i === 0 && mine.open.expectedAmount >= 500 ? 500 : 0;
    await acc('/closings', { method: 'POST', body: { counted: mine.open.expectedAmount - short, expected: mine.open.expectedAmount, explanation: short ? 'Change given wrongly to a parent; to be followed up.' : null } });
    log(`  + ${b.name}: cash closed (${short ? 'shortage $5' : 'balanced'})`);
  }
}

export { iso };

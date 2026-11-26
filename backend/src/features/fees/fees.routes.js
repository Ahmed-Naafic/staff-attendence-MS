import { badRequest, forbidden } from '../../common/httpError.js';
import { isUuid, jsonBody } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { readManagerCreation, readManagerSuspension, readManagerUpdate, readTemporaryPassword } from '../managers/managerInput.js';
import { createAccountant, listAccountants, resetAccountantPassword, setAccountantStatus, updateAccountant, listStaffFeeAccess, setStaffFeeAccess } from './accountants.service.js';
import { permissions, requireFees } from './feeAccess.js';
import {
  addCharge,
  adjustObligation,
  cancelObligation,
  createAdjustment,
  endAdjustment,
  getAccount,
  listAccounts,
  readAccountsQuery,
  readCharge,
  readObligationAdjustment,
  readReasonOnly,
  readStudentAdjustment,
  reinstateObligation,
} from './feeAccounts.service.js';
import { clearanceExams, examClearance, grantException, listStudentClearance, readClearanceQuery, readException, revokeException, studentClearance } from './feeClearance.service.js';
import { closeCash, correctClosing, getClosing, listClosings, myClosing, readClosing, readClosingsQuery, readCorrection } from './feeClosings.service.js';
import { assignDiscount, createPolicy, listPolicies, listStudentDiscounts, readAssignment, readPolicy, revokeDiscount, setPolicyActive, updatePolicy } from './feeDiscounts.service.js';
import { invoicesPdf, receiptPdf, reportPdf, reportXlsx } from './feeDocuments.js';
import { ensureGenerated, generationStatus, runGenerationByHand } from './feeGeneration.service.js';
import { cancelInvoice, createBulkInvoices, createInvoice, findScopedInvoice, getInvoice, invoicesForPdf, issueInvoice, listInvoices, readInvoiceRequest, readInvoicesQuery } from './feeInvoices.service.js';
import { logReminder, parentReminders, readReminderLog } from './feeJobs.js';
import { findScopedReceipt, getPayment, listPayments, markReceiptPrinted, payableObligations, readPayment, readPaymentsQuery, recordPayment, reversePayment, searchPayers } from './feePayments.service.js';
import { buildReport, feeOverview, readReportQuery, REPORTS } from './feeReports.service.js';
import { feeSettingsOf, getBranding, getFeeSettings, readBranding, readFeeSettingsChange, saveBranding, saveFeeSettings } from './feeSettings.js';
import { createStructure, listExamFees, listStructures, readExamFees, readStructure, saveExamFees, updateStructure } from './feeStructures.service.js';

/*
 * Fee Management routes (docs/business-rules.md → Fee Management), the same for the School Owner
 * (/api/owner), Managers (/api/manager) and Accountants (/api/accountant). `scopeOf(req)` → { school,
 * branch } from the account; `role` the account's role. Everything needs the module switched on for
 * the school (403 FEATURE_DISABLED) except /fees/status, which says whether it is. Each service checks
 * the role's permission itself; the configuration is the School Owner's.
 */

const sendFile = (res, { buffer, filename }, type) => {
  res.set('Content-Type', type);
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
};
const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function mountFeeRoutes(router, scopeOf, role) {
  const scope = (req) => ({ ...scopeOf(req), role, user: req.user });

  /** Whether Fee Management is on, the role's permissions, the filter options. */
  router.get('/fees/status', async (req, res) => {
    const s = scope(req);
    const prisma = getPrisma();
    const school = await prisma.school.findUnique({ where: { id: s.school.id }, select: { feesEnabled: true } });
    if (!school?.feesEnabled) return res.json({ featureEnabled: false });
    await ensureGenerated(s.school.id);
    const [settings, years, branches, classes, sections] = await Promise.all([
      feeSettingsOf(s.school.id),
      prisma.academicYear.findMany({ where: { schoolId: s.school.id }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, status: true, startDate: true, endDate: true } }),
      prisma.branch.findMany({ where: { schoolId: s.school.id, ...(s.branch && { id: s.branch.id }) }, orderBy: { number: 'asc' }, select: { id: true, name: true, code: true, status: true } }),
      prisma.schoolClass.findMany({ where: { schoolId: s.school.id }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, status: true } }),
      prisma.section.findMany({ where: { schoolId: s.school.id, academicYear: { status: 'CURRENT' }, ...(s.branch && { branchId: s.branch.id }) }, orderBy: [{ name: 'asc' }], select: { id: true, name: true, classId: true, branchId: true } }),
    ]);
    return res.json({
      featureEnabled: true,
      role,
      branch: s.branch ? { id: s.branch.id, name: s.branch.name } : null,
      currency: settings.currency,
      permissions: permissions(s, settings),
      academicYears: years.map((y) => ({ id: y.id, name: y.name, status: y.status.toLowerCase(), startDate: y.startDate.toISOString().slice(0, 10), endDate: y.endDate.toISOString().slice(0, 10) })),
      branches: branches.map((b) => ({ ...b, status: b.status.toLowerCase() })),
      classes: classes.map((c) => ({ ...c, status: c.status.toLowerCase() })),
      sections,
      reports: Object.entries(REPORTS).map(([key, r]) => ({ key, ...r })).filter((r) => r.key !== 'branches' || role === 'OWNER'),
    });
  });

  router.use('/fees', requireFees(scopeOf));
  // School-wide policies are the School Owner's: a branch role's change is refused before its content is read.
  const OWNER_ONLY = /^\/(settings|branding|structures|exam-fees|discount-policies)(\/|$)/;
  router.use('/fees', (req, res, next) => (role !== 'OWNER' && req.method !== 'GET' && OWNER_ONLY.test(req.path) ? next(forbidden('Only the School Owner changes school fee policies.')) : next()));

  // Overview and generation.
  router.get('/fees/overview', async (req, res) => res.json(await feeOverview(scope(req), readReportQuery(req.query, { role }))));
  router.get('/fees/generation', async (req, res) => res.json(await generationStatus(scope(req))));
  router.post('/fees/generation/run', async (req, res) => {
    const body = jsonBody(req);
    if (body.month !== undefined && body.month !== null && (typeof body.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month))) throw badRequest('Choose a month.', { month: 'Choose a month.' });
    res.json(await runGenerationByHand(scope(req), { month: body.month ?? null }, req.user));
  });

  // Settings and branding (everyone reads; the School Owner changes).
  router.get('/fees/settings', async (req, res) => res.json(await getFeeSettings(scope(req))));
  router.put('/fees/settings', async (req, res) => res.json(await saveFeeSettings(scope(req), readFeeSettingsChange(jsonBody(req)), req.user, req)));
  router.get('/fees/branding', async (req, res) => res.json(await getBranding(scope(req))));
  router.put('/fees/branding', async (req, res) => res.json(await saveBranding(scope(req), readBranding(jsonBody(req)), req.user, req)));

  // Fee structures and examination fees.
  router.get('/fees/structures', async (req, res) => res.json(await listStructures(scope(req), { academicYear: req.query.academicYear })));
  router.post('/fees/structures', async (req, res) => {
    await createStructure(scope(req), readStructure(jsonBody(req), { creating: true }), req.user, req);
    res.status(201).json(await listStructures(scope(req), { academicYear: req.body.academicYear }));
  });
  router.patch('/fees/structures/:id', async (req, res) => {
    const updated = await updateStructure(scope(req), req.params.id, readStructure(jsonBody(req), { creating: false }), req.user, req);
    res.json(await listStructures(scope(req), { academicYear: updated.academicYearId }));
  });
  router.get('/fees/exam-fees', async (req, res) => res.json(await listExamFees(scope(req), { academicYear: req.query.academicYear })));
  router.put('/fees/exam-fees', async (req, res) => res.json(await saveExamFees(scope(req), readExamFees(jsonBody(req)), req.user, req)));

  // Student accounts.
  router.get('/fees/students', async (req, res) => res.json(await listAccounts(scope(req), readAccountsQuery(req.query, { role }))));
  router.get('/fees/students/:id', async (req, res) => res.json(await getAccount(scope(req), req.params.id, { academicYear: req.query.academicYear })));
  router.get('/fees/students/:id/payable', async (req, res) => res.json(await payableObligations(scope(req), req.params.id)));
  router.post('/fees/students/:id/adjustments', async (req, res) => res.status(201).json(await createAdjustment(scope(req), req.params.id, readStudentAdjustment(jsonBody(req)), req.user, req)));
  router.post('/fees/adjustments/:id/end', async (req, res) => {
    await endAdjustment(scope(req), req.params.id, readReasonOnly(jsonBody(req)), req.user, req);
    res.json({ ok: true });
  });
  router.post('/fees/students/:id/charges', async (req, res) => res.status(201).json(await addCharge(scope(req), req.params.id, readCharge(jsonBody(req)), req.user, req)));
  router.post('/fees/obligations/:id/adjust', async (req, res) => {
    await adjustObligation(scope(req), req.params.id, readObligationAdjustment(jsonBody(req)), req.user, req);
    res.json({ ok: true });
  });
  router.post('/fees/obligations/:id/cancel', async (req, res) => {
    await cancelObligation(scope(req), req.params.id, readReasonOnly(jsonBody(req)), req.user, req);
    res.json({ ok: true });
  });
  router.post('/fees/obligations/:id/reinstate', async (req, res) => {
    await reinstateObligation(scope(req), req.params.id, readReasonOnly(jsonBody(req)), req.user, req);
    res.json({ ok: true });
  });

  // Payments and receipts.
  router.get('/fees/payers', async (req, res) => res.json(await searchPayers(scope(req), { q: typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '' })));
  router.get('/fees/payments', async (req, res) => res.json(await listPayments(scope(req), readPaymentsQuery(req.query, { role }))));
  router.post('/fees/payments', async (req, res) => {
    const result = await recordPayment(scope(req), readPayment(jsonBody(req)), req.user, req);
    res.status(result.repeated ? 200 : 201).json(result);
  });
  router.get('/fees/payments/:id', async (req, res) => res.json(await getPayment(scope(req), req.params.id)));
  router.post('/fees/payments/:id/reverse', async (req, res) => res.json(await reversePayment(scope(req), req.params.id, readReasonOnly(jsonBody(req)), req.user, req)));
  router.get('/fees/receipts/:id/pdf', async (req, res) => {
    const receipt = await findScopedReceipt(scope(req), req.params.id);
    const settings = await feeSettingsOf(scope(req).school.id);
    const format = ['a4', 'a5', 'thermal'].includes(req.query.format) ? req.query.format : settings.receiptFormat;
    sendFile(res, receiptPdf(receipt, { format }), PDF);
  });
  router.post('/fees/receipts/:id/printed', async (req, res) => res.json(await markReceiptPrinted(scope(req), req.params.id, req.user, req)));

  // Discounts and scholarships.
  router.get('/fees/discount-policies', async (req, res) => res.json(await listPolicies(scope(req), { status: ['active', 'inactive'].includes(req.query.status) ? req.query.status : 'all' })));
  router.post('/fees/discount-policies', async (req, res) => res.status(201).json({ policy: await createPolicy(scope(req), readPolicy(jsonBody(req), { creating: true }), req.user, req) }));
  router.patch('/fees/discount-policies/:id', async (req, res) => res.json({ policy: await updatePolicy(scope(req), req.params.id, readPolicy(jsonBody(req), { creating: false }), req.user, req) }));
  router.post('/fees/discount-policies/:id/deactivate', async (req, res) => res.json({ policy: await setPolicyActive(scope(req), req.params.id, false, req.user, req) }));
  router.post('/fees/discount-policies/:id/reactivate', async (req, res) => res.json({ policy: await setPolicyActive(scope(req), req.params.id, true, req.user, req) }));
  router.get('/fees/student-discounts', async (req, res) => res.json(await listStudentDiscounts(scope(req), { status: ['active', 'revoked', 'all'].includes(req.query.status) ? req.query.status : 'active', policy: req.query.policy, q: typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '' })));
  router.post('/fees/student-discounts', async (req, res) => res.status(201).json(await assignDiscount(scope(req), readAssignment(jsonBody(req)), req.user, req)));
  router.post('/fees/student-discounts/:id/revoke', async (req, res) => {
    const body = jsonBody(req);
    const { reason } = readReasonOnly(body);
    if (body.fromMonth !== undefined && body.fromMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.fromMonth)) throw badRequest('Choose a month.', { fromMonth: 'Choose a month.' });
    await revokeDiscount(scope(req), req.params.id, { reason, fromMonth: body.fromMonth ? `${body.fromMonth}-01` : null }, req.user, req);
    res.json({ ok: true });
  });

  // Invoices.
  router.get('/fees/invoices', async (req, res) => res.json(await listInvoices(scope(req), readInvoicesQuery(req.query, { role }))));
  router.post('/fees/invoices', async (req, res) => res.status(201).json(await createInvoice(scope(req), readInvoiceRequest(jsonBody(req), { bulk: false }), req.user, req)));
  router.post('/fees/invoices/bulk', async (req, res) => res.status(201).json(await createBulkInvoices(scope(req), readInvoiceRequest(jsonBody(req), { bulk: true }), req.user, req)));
  router.get('/fees/invoices/pdf', async (req, res) => {
    const batch = typeof req.query.batch === 'string' && isUuid(req.query.batch) ? req.query.batch : null;
    const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(isUuid).slice(0, 500) : [];
    if (!batch && !ids.length) throw badRequest('Choose the invoices.');
    const list = await invoicesForPdf(scope(req), { batch, ids });
    sendFile(res, invoicesPdf(list, (await feeSettingsOf(scope(req).school.id)).currency), PDF);
  });
  router.get('/fees/invoices/:id', async (req, res) => res.json(await getInvoice(scope(req), req.params.id)));
  router.get('/fees/invoices/:id/pdf', async (req, res) => {
    const inv = await findScopedInvoice(getPrisma(), scope(req), req.params.id);
    sendFile(res, invoicesPdf([inv], (await feeSettingsOf(scope(req).school.id)).currency), PDF);
  });
  router.post('/fees/invoices/:id/issue', async (req, res) => res.json(await issueInvoice(scope(req), req.params.id, req.user, req)));
  router.post('/fees/invoices/:id/cancel', async (req, res) => res.json(await cancelInvoice(scope(req), req.params.id, readReasonOnly(jsonBody(req)), req.user, req)));

  // Fee clearance.
  router.get('/fees/clearance', async (req, res) => res.json(await listStudentClearance(scope(req), readClearanceQuery(req.query, { role }))));
  router.get('/fees/clearance/students/:id', async (req, res) => res.json(await studentClearance(scope(req), req.params.id)));
  router.get('/fees/clearance/exams', async (req, res) => res.json(await clearanceExams(scope(req))));
  router.get('/fees/clearance/exams/:id', async (req, res) => res.json(await examClearance(scope(req), req.params.id, readClearanceQuery(req.query, { role }))));
  router.post('/fees/clearance/exceptions', async (req, res) => res.status(201).json(await grantException(scope(req), readException(jsonBody(req)), req.user, req)));
  router.post('/fees/clearance/exceptions/:id/revoke', async (req, res) => {
    await revokeException(scope(req), req.params.id, readReasonOnly(jsonBody(req)), req.user, req);
    res.json({ ok: true });
  });

  // Cash closing.
  router.get('/fees/closings/mine', async (req, res) => res.json(await myClosing(scope(req), req.user)));
  router.post('/fees/closings', async (req, res) => res.status(201).json(await closeCash(scope(req), readClosing(jsonBody(req)), req.user, req)));
  router.get('/fees/closings', async (req, res) => res.json(await listClosings(scope(req), readClosingsQuery(req.query, { role }))));
  router.get('/fees/closings/:id', async (req, res) => res.json(await getClosing(scope(req), req.params.id)));
  router.post('/fees/closings/:id/correct', async (req, res) => res.json(await correctClosing(scope(req), req.params.id, readCorrection(jsonBody(req)), req.user, req)));

  // Reports (JSON, PDF, Excel).
  router.get('/fees/reports/:name', async (req, res) => {
    const match = /^([a-z]+)(?:\.(pdf|xlsx))?$/.exec(req.params.name);
    if (!match || !REPORTS[match[1]]) throw badRequest('Unknown report.');
    const s = scope(req);
    const filters = readReportQuery(req.query, { role });
    const report = await buildReport(s, match[1], filters);
    if (!match[2]) return res.json(report);
    const names = await filterNames(s, filters);
    if (match[2] === 'pdf') return sendFile(res, reportPdf(report, { schoolName: s.school.name, filters: names }), PDF);
    return sendFile(res, reportXlsx(report, { filters: names }), XLSX);
  });

  // Parent reminders (sent by staff from their phone; logged).
  router.get('/fees/reminders', async (req, res) => res.json(await parentReminders(scope(req))));
  router.post('/fees/reminders', async (req, res) => res.status(201).json(await logReminder(scope(req), readReminderLog(jsonBody(req)), req.user, req)));

  // Accountant accounts (School Owner).
  if (role === 'OWNER') {
    router.get('/fees/accountants', async (req, res) => res.json(await listAccountants(scopeOf(req).school)));
    router.post('/fees/accountants', async (req, res) => res.status(201).json({ accountant: await createAccountant(scopeOf(req).school, readManagerCreation(jsonBody(req)), req.user, req) }));
    router.patch('/fees/accountants/:id', async (req, res) => {
      const { branchId, ...rest } = jsonBody(req);
      const values = Object.keys(rest).length ? readManagerUpdate(rest) : {};
      if (branchId !== undefined) {
        if (!isUuid(branchId)) throw badRequest('Choose a branch.', { branchId: 'Choose a branch.' });
        values.branchId = branchId;
      }
      if (!Object.keys(values).length) throw badRequest('Send at least one field to change.');
      res.json({ accountant: await updateAccountant(scopeOf(req).school, req.params.id, values, req.user, req) });
    });
    router.post('/fees/accountants/:id/suspend', async (req, res) => res.json({ accountant: await setAccountantStatus(scopeOf(req).school, req.params.id, { suspend: true, reason: readManagerSuspension(jsonBody(req)) }, req.user, req) }));
    router.post('/fees/accountants/:id/reactivate', async (req, res) => res.json({ accountant: await setAccountantStatus(scopeOf(req).school, req.params.id, { suspend: false }, req.user, req) }));
    // Fee Management access for staff members (the Accountant workspace with their staff sign-in).
    router.get('/fees/staff-access', async (req, res) => res.json(await listStaffFeeAccess(scopeOf(req).school)));
    router.put('/fees/staff-access/:id', async (req, res) => {
      const { access, ...rest } = jsonBody(req);
      if (typeof access !== 'boolean' || Object.keys(rest).length) throw badRequest('Send { access: true | false }.', { access: 'Choose whether the staff member has access.' });
      res.json({ staff: await setStaffFeeAccess(scopeOf(req).school, req.params.id, access, req.user, req) });
    });
    router.post('/fees/accountants/:id/password', async (req, res) => res.json({ accountant: await resetAccountantPassword(scopeOf(req).school, req.params.id, readTemporaryPassword(jsonBody(req)), req.user, req) }));
  } else {
    router.use('/fees/accountants', (req, res, next) => next(forbidden('Only the School Owner manages Accountant accounts.')));
    router.use('/fees/staff-access', (req, res, next) => next(forbidden('Only the School Owner gives Fee Management access.')));
  }
}

/** Names of the filters for export headings. */
async function filterNames(scope, f) {
  const prisma = getPrisma();
  const [branch, cls] = await Promise.all([
    f.branch ? prisma.branch.findFirst({ where: { id: f.branch, schoolId: scope.school.id }, select: { name: true } }) : scope.branch ? { name: scope.branch.name } : null,
    f.classId ? prisma.schoolClass.findFirst({ where: { id: f.classId, schoolId: scope.school.id }, select: { name: true } }) : null,
  ]);
  return { branchName: branch?.name ?? 'All branches', className: cls?.name ?? null };
}

import { apiDownload, apiRequest } from '../../../lib/api.js';

/*
 * Fee Management (docs/business-rules.md → Fee Management). The same API for the School Owner
 * (/owner/fees), Managers (/manager/fees) and Accountants (/accountant/fees); the server decides the
 * school and branch from the account and checks every permission. Errors: 400 VALIDATION_ERROR (details
 * per field), 403 FEATURE_DISABLED / FORBIDDEN, 404 NOT_FOUND, 409 business conflicts (MONTH_CHARGED,
 * ALREADY_REVERSED, EXPECTED_CHANGED, NOTHING_TO_INVOICE, …).
 */
const PREFIX = { OWNER: '/owner', MANAGER: '/manager', ACCOUNTANT: '/accountant' };
const base = (role) => `${PREFIX[role] ?? '/manager'}/fees`;
const id = (value) => encodeURIComponent(value);
/** Query values: empty ones and 'all' are left out. */
const q = (values) => Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all'));

export const loadFeeStatus = (role) => apiRequest(`${base(role)}/status`);
export const loadOverview = (role, filters) => apiRequest(`${base(role)}/overview`, { query: q(filters) });
export const loadGeneration = (role) => apiRequest(`${base(role)}/generation`);
export const runGeneration = (role, month) => apiRequest(`${base(role)}/generation/run`, { method: 'POST', body: { month: month || null } });

// Settings and branding.
export const loadFeeSettings = (role) => apiRequest(`${base(role)}/settings`);
export const saveFeeSettings = (role, values) => apiRequest(`${base(role)}/settings`, { method: 'PUT', body: { values } });
export const loadBranding = (role) => apiRequest(`${base(role)}/branding`);
export const saveBranding = (role, body) => apiRequest(`${base(role)}/branding`, { method: 'PUT', body });

// Structures and examination fees.
export const loadStructures = (role, academicYear) => apiRequest(`${base(role)}/structures`, { query: q({ academicYear }) });
export const createStructure = (role, body) => apiRequest(`${base(role)}/structures`, { method: 'POST', body });
export const updateStructure = (role, structureId, body) => apiRequest(`${base(role)}/structures/${id(structureId)}`, { method: 'PATCH', body });
export const loadExamFees = (role, academicYear) => apiRequest(`${base(role)}/exam-fees`, { query: q({ academicYear }) });
export const saveExamFees = (role, body) => apiRequest(`${base(role)}/exam-fees`, { method: 'PUT', body });

// Student accounts.
export const loadAccounts = (role, filters) => apiRequest(`${base(role)}/students`, { query: q(filters) });
export const loadAccount = (role, studentId, academicYear) => apiRequest(`${base(role)}/students/${id(studentId)}`, { query: q({ academicYear }) });
export const loadPayable = (role, studentId) => apiRequest(`${base(role)}/students/${id(studentId)}/payable`);
export const createAdjustment = (role, studentId, body) => apiRequest(`${base(role)}/students/${id(studentId)}/adjustments`, { method: 'POST', body });
export const endAdjustment = (role, adjustmentId, reason) => apiRequest(`${base(role)}/adjustments/${id(adjustmentId)}/end`, { method: 'POST', body: { reason } });
export const addCharge = (role, studentId, body) => apiRequest(`${base(role)}/students/${id(studentId)}/charges`, { method: 'POST', body });
export const adjustObligation = (role, obligationId, body) => apiRequest(`${base(role)}/obligations/${id(obligationId)}/adjust`, { method: 'POST', body });
export const cancelObligation = (role, obligationId, reason) => apiRequest(`${base(role)}/obligations/${id(obligationId)}/cancel`, { method: 'POST', body: { reason } });
export const reinstateObligation = (role, obligationId, reason) => apiRequest(`${base(role)}/obligations/${id(obligationId)}/reinstate`, { method: 'POST', body: { reason } });

// Payments and receipts.
export const searchPayers = (role, text) => apiRequest(`${base(role)}/payers`, { query: q({ q: text }) });
export const loadPayments = (role, filters) => apiRequest(`${base(role)}/payments`, { query: q(filters) });
export const recordPayment = (role, body) => apiRequest(`${base(role)}/payments`, { method: 'POST', body });
export const reversePayment = (role, paymentId, reason) => apiRequest(`${base(role)}/payments/${id(paymentId)}/reverse`, { method: 'POST', body: { reason } });
export const downloadReceipt = (role, receiptId, format) => apiDownload(`${base(role)}/receipts/${id(receiptId)}/pdf`, { query: q({ format }) });
export const markReceiptPrinted = (role, receiptId) => apiRequest(`${base(role)}/receipts/${id(receiptId)}/printed`, { method: 'POST' });

// Discounts and scholarships.
export const loadPolicies = (role, status) => apiRequest(`${base(role)}/discount-policies`, { query: q({ status }) });
export const createPolicy = (role, body) => apiRequest(`${base(role)}/discount-policies`, { method: 'POST', body });
export const updatePolicy = (role, policyId, body) => apiRequest(`${base(role)}/discount-policies/${id(policyId)}`, { method: 'PATCH', body });
export const setPolicyActive = (role, policyId, active) => apiRequest(`${base(role)}/discount-policies/${id(policyId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
export const loadStudentDiscounts = (role, filters) => apiRequest(`${base(role)}/student-discounts`, { query: q(filters) });
export const assignDiscount = (role, body) => apiRequest(`${base(role)}/student-discounts`, { method: 'POST', body });
export const revokeDiscount = (role, discountId, body) => apiRequest(`${base(role)}/student-discounts/${id(discountId)}/revoke`, { method: 'POST', body });

// Invoices.
export const loadInvoices = (role, filters) => apiRequest(`${base(role)}/invoices`, { query: q(filters) });
export const loadInvoice = (role, invoiceId) => apiRequest(`${base(role)}/invoices/${id(invoiceId)}`);
export const createInvoice = (role, body) => apiRequest(`${base(role)}/invoices`, { method: 'POST', body });
export const createBulkInvoices = (role, body) => apiRequest(`${base(role)}/invoices/bulk`, { method: 'POST', body });
export const issueInvoice = (role, invoiceId) => apiRequest(`${base(role)}/invoices/${id(invoiceId)}/issue`, { method: 'POST' });
export const cancelInvoice = (role, invoiceId, reason) => apiRequest(`${base(role)}/invoices/${id(invoiceId)}/cancel`, { method: 'POST', body: { reason } });
export const downloadInvoice = (role, invoiceId) => apiDownload(`${base(role)}/invoices/${id(invoiceId)}/pdf`);
export const downloadInvoices = (role, { batch, ids }) => apiDownload(`${base(role)}/invoices/pdf`, { query: q({ batch, ids: ids?.join(',') }) });

// Fee clearance.
export const loadClearance = (role, filters) => apiRequest(`${base(role)}/clearance`, { query: q(filters) });
export const loadStudentClearance = (role, studentId) => apiRequest(`${base(role)}/clearance/students/${id(studentId)}`);
export const loadClearanceExams = (role) => apiRequest(`${base(role)}/clearance/exams`);
export const loadExamClearance = (role, examId, filters) => apiRequest(`${base(role)}/clearance/exams/${id(examId)}`, { query: q(filters) });
export const grantException = (role, body) => apiRequest(`${base(role)}/clearance/exceptions`, { method: 'POST', body });
export const revokeException = (role, exceptionId, reason) => apiRequest(`${base(role)}/clearance/exceptions/${id(exceptionId)}/revoke`, { method: 'POST', body: { reason } });

// Cash closing.
export const loadMyClosing = (role) => apiRequest(`${base(role)}/closings/mine`);
export const closeCash = (role, body) => apiRequest(`${base(role)}/closings`, { method: 'POST', body });
export const loadClosings = (role, filters) => apiRequest(`${base(role)}/closings`, { query: q(filters) });
export const loadClosing = (role, closingId) => apiRequest(`${base(role)}/closings/${id(closingId)}`);
export const correctClosing = (role, closingId, body) => apiRequest(`${base(role)}/closings/${id(closingId)}/correct`, { method: 'POST', body });

// Reports.
export const loadReport = (role, name, filters) => apiRequest(`${base(role)}/reports/${id(name)}`, { query: q(filters) });
export const downloadReport = (role, name, format, filters) => apiDownload(`${base(role)}/reports/${id(name)}.${format}`, { query: q(filters) });

// Parent reminders.
export const loadReminders = (role) => apiRequest(`${base(role)}/reminders`);
export const logReminder = (role, body) => apiRequest(`${base(role)}/reminders`, { method: 'POST', body });

// Accountant accounts (School Owner).
export const loadAccountants = () => apiRequest('/owner/fees/accountants');
export const createAccountant = (body) => apiRequest('/owner/fees/accountants', { method: 'POST', body });
export const updateAccountant = (accountantId, body) => apiRequest(`/owner/fees/accountants/${id(accountantId)}`, { method: 'PATCH', body });
export const suspendAccountant = (accountantId, reason) => apiRequest(`/owner/fees/accountants/${id(accountantId)}/suspend`, { method: 'POST', body: { reason } });
export const reactivateAccountant = (accountantId) => apiRequest(`/owner/fees/accountants/${id(accountantId)}/reactivate`, { method: 'POST' });
export const resetAccountantPassword = (accountantId, password) => apiRequest(`/owner/fees/accountants/${id(accountantId)}/password`, { method: 'POST', body: { password } });

// Moving a student to another branch (School Owner; the students API).
export const transferStudentBranch = (studentId, body) => apiRequest(`/owner/students/${id(studentId)}/transfer-branch`, { method: 'POST', body });

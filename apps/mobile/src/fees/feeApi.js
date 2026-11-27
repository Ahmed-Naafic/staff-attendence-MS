/*
 * The existing Fee Management API (backend/src/features/fees/fees.routes.js), as the open workspace
 * may use it: /api/accountant/fees for the Accountant workspace (also staff with Fee Management
 * access), /api/manager/fees for Managers. The server decides every permission and the branch scope;
 * nothing here duplicates a rule. Payments and cash closings are online only and never queued.
 */

const BASES = { accountant: '/api/accountant/fees', manager: '/api/manager/fees' };

export function feeBase(workspace) {
  const base = BASES[workspace];
  if (!base) throw new Error('Fee Management is not part of this workspace.');
  return base;
}

const query = (params = {}) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

const get = (api, ws, path, params) => api.request(`${feeBase(ws)}${path}${query(params)}`).then(({ data }) => data);
const post = (api, ws, path, body) => api.request(`${feeBase(ws)}${path}`, { method: 'POST', body }).then(({ status, data }) => ({ status, ...data }));

export const loadOverview = (api, ws) => get(api, ws, '/overview');
export const loadMyClosing = (api, ws) => get(api, ws, '/closings/mine');
export const loadAccounts = (api, ws, params) => get(api, ws, '/students', params);
export const loadPayable = (api, ws, studentId) => get(api, ws, `/students/${encodeURIComponent(studentId)}/payable`);
export const searchPayers = (api, ws, text) => get(api, ws, '/payers', { q: text });
export const loadPayments = (api, ws, params) => get(api, ws, '/payments', params);
export const loadPayment = (api, ws, id) => get(api, ws, `/payments/${encodeURIComponent(id)}`);
export const loadStructures = (api, ws) => get(api, ws, '/structures');
export const loadInvoices = (api, ws, params) => get(api, ws, '/invoices', params);
export const loadInvoice = (api, ws, id) => get(api, ws, `/invoices/${encodeURIComponent(id)}`);
export const loadPolicies = (api, ws) => get(api, ws, '/discount-policies', { status: 'all' });
export const loadStudentDiscounts = (api, ws, params) => get(api, ws, '/student-discounts', params);
export const loadClosings = (api, ws, params) => get(api, ws, '/closings', params);
export const loadReport = (api, ws, name, params) => get(api, ws, `/reports/${encodeURIComponent(name)}`, params);

/**
 * Records a cash payment (online only). `requestKey` is made once per payment on the phone and sent
 * with every try, so a retry after a lost answer returns the first payment instead of a second one.
 * → { status: 201 | 200 (repeat), payment, repeated }.
 */
export const recordPayment = (api, ws, { studentId, amount, allocations, note, requestKey }) =>
  post(api, ws, '/payments', { student: studentId, amount, method: 'cash', allocations: allocations.map((a) => ({ obligation: a.obligationId, amount: a.amount })), ...(note ? { note } : {}), requestKey });

/** Closes the user's cash (online only). `expected`: the amount the screen showed (the server checks it). */
export const closeCash = (api, ws, { counted, explanation, expected }) => post(api, ws, '/closings', { counted, ...(explanation ? { explanation } : {}), expected });

export const REPORTS = [
  ['collection', 'Fee collection'],
  ['sheet', 'Monthly fee sheet'],
  ['outstanding', 'Outstanding fees'],
  ['overdue', 'Overdue fees'],
  ['daily', 'Daily payments'],
  ['history', 'Payment history'],
  ['closings', 'Cash closing'],
  ['trends', 'Monthly collection trends'],
  ['classes', 'Class comparison'],
  ['discounts', 'Discount analysis'],
  ['performance', 'Payment performance'],
  ['expected', 'Expected vs actual'],
];

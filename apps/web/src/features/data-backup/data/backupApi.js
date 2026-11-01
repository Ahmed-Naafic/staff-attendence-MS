import { apiRequest } from '../../../lib/api.js';

// Data & Backup API (Super Admin; docs/data-backup/backup-api.md). Responses never carry Neon's API
// key or a connection string.
const BASE = '/platform/backups';

export const loadOverview = (signal) => apiRequest(`${BASE}/overview`, { signal });
export const loadBackups = ({ status, kind, page, pageSize }, signal) => apiRequest(BASE, { query: { status, kind, page, pageSize }, signal });
export const loadConfiguration = (signal) => apiRequest(`${BASE}/configuration`, { signal });
export const saveConfiguration = (values) => apiRequest(`${BASE}/configuration`, { method: 'PUT', body: values });
export const createBackup = () => apiRequest(BASE, { method: 'POST', body: { confirm: true } });
export const loadOperation = (id) => apiRequest(`${BASE}/operations/${id}`);
export const verifyBackup = (id) => apiRequest(`${BASE}/${encodeURIComponent(id)}/verify`, { method: 'POST', body: {} });
export const setProtection = (id, value) => apiRequest(`${BASE}/${encodeURIComponent(id)}/protection`, { method: 'POST', body: { protected: value } });
export const deleteBackup = (id) => apiRequest(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const loadRestores = (signal) => apiRequest(`${BASE}/restores`, { signal });
export const loadRestore = (id) => apiRequest(`${BASE}/restores/${id}`);
export const startRestore = (snapshotId) => apiRequest(`${BASE}/restores`, { method: 'POST', body: { snapshotId, confirm: true } });
export const discardRestore = (id) => apiRequest(`${BASE}/restores/${id}/discard`, { method: 'POST', body: {} });
/** The only call that replaces production data. */
export const finalizeRestore = (id, body) => apiRequest(`${BASE}/restores/${id}/finalize`, { method: 'POST', body });

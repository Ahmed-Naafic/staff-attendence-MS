import { apiRequest } from '../../../lib/api.js';

/**
 * The signed-in Manager's branch and school (GET /api/manager/branch): { branch: { id, code, name,
 * address, city, phone, status, operating, notOperatingReasons }, school: { id, code, name, status } }.
 * The branch is decided by the server on every request (it follows transfers at once).
 */
export const loadMyBranch = () => apiRequest('/manager/branch');

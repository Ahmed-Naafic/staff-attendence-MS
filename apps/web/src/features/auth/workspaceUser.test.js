import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceUser } from './workspaceUser.js';

test('workspaceUser: a staff member with Fee Management access works as an Accountant; others are unchanged', () => {
  assert.deepEqual(workspaceUser({ id: '1', role: 'STAFF', feeAccess: true }), { id: '1', role: 'ACCOUNTANT', feeAccess: true, accountRole: 'STAFF' });
  const staff = { id: '2', role: 'STAFF', feeAccess: false };
  assert.equal(workspaceUser(staff), staff);
  const manager = { id: '3', role: 'MANAGER', feeAccess: true };
  assert.equal(workspaceUser(manager), manager, 'only staff members');
  assert.equal(workspaceUser(null), null);
});

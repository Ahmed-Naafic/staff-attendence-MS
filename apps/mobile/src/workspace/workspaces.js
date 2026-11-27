/*
 * Workspaces of the mobile app (docs/mobile/workspaces.md). They come only from the account's
 * existing role and permissions, as the server reports them in the session, never from settings
 * on the phone:
 *   STAFF                     → Teacher (staff check-in, classes, student attendance, exams)
 *   STAFF with feeAccess      → Teacher and Accountant (the School Owner granted Fee Management)
 *   ACCOUNTANT                → Accountant
 *   MANAGER                   → Manager
 * Owners and Platform Admins use the web app. The server checks every request again.
 */

export const WORKSPACES = {
  teacher: { key: 'teacher', label: 'Teacher', icon: 'school-outline' },
  accountant: { key: 'accountant', label: 'Accountant', icon: 'cash-outline' },
  manager: { key: 'manager', label: 'Manager', icon: 'briefcase-outline' },
};

export const MOBILE_ROLES = ['STAFF', 'MANAGER', 'ACCOUNTANT'];

/** The workspaces an account may open, in menu order. */
export function workspacesFor(user) {
  if (!user) return [];
  if (user.role === 'STAFF') return user.feeAccess === true ? ['teacher', 'accountant'] : ['teacher'];
  if (user.role === 'MANAGER') return ['manager'];
  if (user.role === 'ACCOUNTANT') return ['accountant'];
  return [];
}

/** The remembered workspace when it is still allowed, else the first allowed one. */
export function chooseWorkspace(available, remembered) {
  return available.includes(remembered) ? remembered : (available[0] ?? null);
}

/**
 * The branches a workspace works in: [{ id, code, name, home }], home branch first, no duplicates.
 * Teacher: the home branch and every branch the teacher teaches in. Manager and Accountant: their
 * one branch. `home` is the account's own branch (never changed by choosing another one here).
 */
export function branchList(home, others = []) {
  const list = [];
  const seen = new Set();
  for (const [b, isHome] of [[home, true], ...others.map((o) => [o, false])]) {
    if (!b || !(b.id || b.code)) continue;
    const key = b.id ?? b.code;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ id: key, code: b.code ?? null, name: b.name ?? b.code ?? 'Branch', home: isHome });
  }
  return list;
}

/** The remembered branch when it is still in the list, else the home branch (or the first). */
export function chooseBranch(branches, remembered) {
  if (branches.some((b) => b.id === remembered)) return remembered;
  return (branches.find((b) => b.home) ?? branches[0])?.id ?? null;
}

/** Whether an item (with `branch` or `section.branch`) belongs to the selected branch (no branch info: shown). */
export function inBranch(item, branchId) {
  if (!branchId) return true;
  const b = item?.branch ?? item?.section?.branch;
  if (!b) return true;
  return (b.id ?? b.code) === branchId;
}

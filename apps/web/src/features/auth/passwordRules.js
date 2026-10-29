// Password rules shown immediately in the web app, mirroring the API (backend/src/features/auth/
// password.js): 12–128 characters, not only spaces, used exactly as typed (never trimmed). The API
// checks again and has the final say.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** The problem with a new password (temporary or chosen), or null. */
export function passwordProblem(password, { label = 'a password' } = {}) {
  if (!password) return `Enter ${label}.`;
  if (!password.trim()) return 'The password cannot be only spaces.';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** Replacing a temporary password: problems for { currentPassword, newPassword, confirmPassword }. */
export function validatePasswordChange({ currentPassword, newPassword, confirmPassword }) {
  const problems = {};
  if (!currentPassword) problems.currentPassword = 'Enter your temporary password.';
  const problem = passwordProblem(newPassword, { label: 'a new password' });
  if (problem) problems.newPassword = problem;
  else if (newPassword === currentPassword) problems.newPassword = 'Choose a password different from the temporary one.';
  if (!problems.newPassword && confirmPassword !== newPassword) problems.confirmPassword = 'The passwords do not match.';
  return problems;
}

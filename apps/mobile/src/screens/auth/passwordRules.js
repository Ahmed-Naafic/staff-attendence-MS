// Password rules shown immediately, mirroring the API (backend/src/features/auth/password.js) and
// the web app (apps/web/src/features/auth/passwordRules.js): 12–128 characters, not only spaces,
// used exactly as typed. The API checks again and has the final say.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function passwordProblem(password) {
  if (!password) return 'Enter a new password.';
  if (!password.trim()) return 'The password cannot be only spaces.';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** Problems for { currentPassword, newPassword, confirmPassword }. */
export function validatePasswordChange({ currentPassword, newPassword, confirmPassword }) {
  const problems = {};
  if (!currentPassword) problems.currentPassword = 'Enter your temporary password.';
  const problem = passwordProblem(newPassword);
  if (problem) problems.newPassword = problem;
  else if (newPassword === currentPassword) problems.newPassword = 'Choose a password different from the temporary one.';
  if (!problems.newPassword && confirmPassword !== newPassword) problems.confirmPassword = 'The passwords do not match.';
  return problems;
}

/** The checklist under the fields. */
export const passwordRules = ({ currentPassword, newPassword, confirmPassword }) => [
  { label: `${PASSWORD_MIN} to ${PASSWORD_MAX} characters`, met: newPassword.length >= PASSWORD_MIN && newPassword.length <= PASSWORD_MAX },
  { label: 'Not only spaces', met: Boolean(newPassword.trim()) },
  { label: 'Different from your temporary password', met: Boolean(newPassword) && newPassword !== currentPassword },
  { label: 'Both new passwords match', met: Boolean(newPassword) && newPassword === confirmPassword },
];

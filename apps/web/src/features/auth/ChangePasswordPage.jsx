import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { ThemeToggle } from '../../components/layout';
import { Alert, Button, Card, Input } from '../../components/ui';
import { createSingleFlight } from '../../lib/singleFlight.js';
import { useBranding } from '../branding';
import { validatePasswordChange } from './passwordRules.js';
import { useSession } from './SessionProvider.jsx';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * Shown instead of every page while the signed-in account must replace its temporary password
 * (a new Manager, or after their owner reset it). The API refuses everything else until then
 * (403 PASSWORD_CHANGE_REQUIRED), so this page is only the way through, not the safeguard.
 */
export default function ChangePasswordPage() {
  const { user, changePassword, signOut } = useSession();
  const { platformName, loaded } = useBranding();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);

  useEffect(() => {
    if (loaded) document.title = `Change your password · ${platformName}`;
  }, [loaded, platformName]);

  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    if (errors[field]) setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  async function save() {
    setFormError('');
    const problems = validatePasswordChange(values);
    setErrors(problems);
    if (Object.keys(problems).length) {
      document.getElementById(`change-${Object.keys(problems)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      // On success the session no longer requires a change and the app shows the workspace.
      await changePassword(values.currentPassword, values.newPassword);
    } catch (error) {
      setSaving(false);
      if (error.details) setErrors(error.details);
      else setFormError(error.status === 429 || error.status === 0 ? error.message : 'Your password could not be changed. Try again.');
    }
  }

  const field = (name) => ({ id: `change-${name}`, value: values[name], onChange: set(name), error: errors[name] });

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <main id="main-content" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        <Card className="w-full max-w-sm gap-6 p-6 sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 place-items-center rounded-md border border-accent/50 bg-sidebar text-accent">
              <KeyRound aria-hidden="true" className="size-6" />
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="text-page-title text-fg">Change your password</h1>
              <p className="text-small text-fg-muted">
                Welcome, {user.name}. You signed in with a temporary password. Choose your own password to continue.
              </p>
            </div>
          </div>

          {formError && <Alert variant="error">{formError}</Alert>}

          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              return saveOnce(save);
            }}
          >
            <Input label="Temporary password" type="password" autoComplete="current-password" required {...field('currentPassword')} />
            <Input label="New password" type="password" autoComplete="new-password" required hint="At least 12 characters." {...field('newPassword')} />
            <Input label="Confirm new password" type="password" autoComplete="new-password" required {...field('confirmPassword')} />
            <Button type="submit" loading={saving} className="mt-2 w-full">
              Change Password
            </Button>
            <Button variant="ghost" onClick={signOut} disabled={saving} className="w-full">
              Sign out
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}

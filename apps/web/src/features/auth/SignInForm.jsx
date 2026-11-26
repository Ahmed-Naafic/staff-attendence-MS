import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Input } from '../../components/ui';
import { getRoleProfile } from '../../app/config/navigation.js';
import { useSession } from './SessionProvider.jsx';

// Only same-app paths are followed after sign-in (no "//host" or absolute URLs).
export const safeNext = (value) => (value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login') ? value : null);

/**
 * The sign-in form: email (or, for staff, phone number) and password. After signing in it opens `next`
 * (a same-app path, e.g. the page that asked for a session) or the role's start page. Shown in the
 * landing page's Sign In dialog.
 */
export function SignInForm({ next, autoFocus = true }) {
  const { ended, signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email or phone number, and your password.');
      return;
    }
    setSubmitting(true);
    try {
      const signedIn = await signIn(email.trim(), password);
      navigate(safeNext(next) ?? getRoleProfile(signedIn.role)?.home ?? '/', { replace: true });
    } catch (failure) {
      setPassword('');
      setError(failure.status === 401 || failure.status === 429 ? failure.message : 'Sign-in is unavailable right now. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {ended && !error && <Alert variant="info">Your session ended. Sign in again to continue.</Alert>}
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Email or phone number"
          type="text"
          inputMode="email"
          autoComplete="username"
          hint="Staff sign in with their phone number."
          autoFocus={autoFocus}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <Button type="submit" loading={submitting} className="mt-2 w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}

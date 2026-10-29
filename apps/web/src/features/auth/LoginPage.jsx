import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { BookOpen } from 'lucide-react';
import { ThemeToggle } from '../../components/layout';
import { Alert, Button, Card, Input } from '../../components/ui';
import { getRoleProfile } from '../../app/config/navigation.js';
import { cn } from '../../lib/cn.js';
import { useBranding } from '../branding';
import { useSession } from './SessionProvider.jsx';

// Only same-app paths are followed after sign-in (no "//host" or absolute URLs).
const safeNext = (value) => (value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login') ? value : null);

/** Sign-in page: email (or, for staff, phone number) and password. */
export default function LoginPage() {
  const { status, user, ended, signIn } = useSession();
  const { platformName, loaded } = useBranding();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const next = safeNext(params.get('next'));

  useEffect(() => {
    if (loaded) document.title = `Sign in · ${platformName}`;
  }, [loaded, platformName]);

  if (status === 'signed-in' && !submitting) {
    return <Navigate to={next ?? getRoleProfile(user.role)?.home ?? '/'} replace />;
  }

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
      navigate(next ?? getRoleProfile(signedIn.role)?.home ?? '/', { replace: true });
    } catch (failure) {
      setPassword('');
      setError(
        failure.status === 401 || failure.status === 429
          ? failure.message
          : 'Sign-in is unavailable right now. Check your connection and try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <main id="main-content" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        <Card className="w-full max-w-sm gap-6 p-6 sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 place-items-center rounded-md border border-accent/50 bg-sidebar text-accent">
              <BookOpen aria-hidden="true" className="size-6" />
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="text-page-title text-fg">Sign in</h1>
              {/* The saved platform name (EduTrack when unavailable); invisible for the moment it loads. */}
              <p className={cn('text-small text-fg-muted wrap-anywhere', !loaded && 'invisible')}>{platformName} — staff attendance for schools</p>
            </div>
          </div>

          {ended && !error && <Alert variant="info">Your session ended. Sign in again to continue.</Alert>}
          {error && <Alert variant="error">{error}</Alert>}

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Input
              label="Email or phone number"
              type="text"
              inputMode="email"
              autoComplete="username"
              hint="Staff sign in with their phone number."
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" loading={submitting} className="mt-2 w-full">
              Sign in
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}

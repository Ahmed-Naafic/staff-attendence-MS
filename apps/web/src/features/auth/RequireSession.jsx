import { Navigate, useLocation } from 'react-router';
import { ErrorState, LoadingState } from '../../components/ui';
import ChangePasswordPage from './ChangePasswordPage.jsx';
import { useSession } from './SessionProvider.jsx';

/**
 * Shows its children only to a signed-in user; otherwise sends them to /login (remembering where
 * they were going). An account with a temporary password sees only the Change Password page until it
 * is replaced. This is for usability: the API enforces both on every request.
 */
export function RequireSession({ children }) {
  const { status, user, retry } = useSession();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <main className="grid min-h-dvh place-items-center bg-page">
        <LoadingState label="Checking your session…" />
      </main>
    );
  }
  if (status === 'unavailable') {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <ErrorState
          title="EduTrack is not reachable"
          description="Your session could not be checked. Check your connection and try again."
          onRetry={retry}
        />
      </main>
    );
  }
  if (status !== 'signed-in') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (user.mustChangePassword) return <ChangePasswordPage />;
  return children;
}

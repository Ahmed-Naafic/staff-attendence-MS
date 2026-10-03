import { Navigate, useLocation } from 'react-router';
import { ErrorState, LoadingState } from '../../components/ui';
import { useSession } from './SessionProvider.jsx';

/**
 * Shows its children only to a signed-in user; otherwise sends them to /login (remembering where
 * they were going). This is for usability: the API enforces access on every request.
 */
export function RequireSession({ children }) {
  const { status, retry } = useSession();
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
  return children;
}

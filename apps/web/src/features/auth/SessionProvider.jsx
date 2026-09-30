import { createContext, useContext } from 'react';
import { mockSession } from './mockSession.js';

// Single source of "who is signed in" for the web app.
// Today it serves the demo session (see mockSession.js); the authentication phase
// replaces the value here without changing any consumer of useSession().
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  return <SessionContext.Provider value={mockSession}>{children}</SessionContext.Provider>;
}

/** Returns { user: { id, name, role }, isDemo }. */
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>.');
  return session;
}

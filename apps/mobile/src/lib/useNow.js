import { useEffect, useState } from 'react';

/** The current time in ms, updated every `intervalMs` (for countdowns such as the 24-hour limit). */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

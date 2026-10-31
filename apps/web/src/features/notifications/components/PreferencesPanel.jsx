import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Alert, Card, CardContent, CardHeader, ErrorState, LoadingState, Switch } from '../../../components/ui';
import { loadPreferences, savePreferences } from '../data/notificationsApi.js';
import { preferenceRows, toggledCategories } from '../utils/notificationRules.js';

/**
 * The signed-in user's notification categories (N12): optional ones can be turned off; mandatory
 * ones (suspensions and reactivations, transfers, platform announcements) stay on. Each change is
 * saved at once (and recorded in the audit log by the server).
 */
export function PreferencesPanel() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadPreferences(controller.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((error) => error.name !== 'AbortError' && setState({ status: 'error', data: null }));
    return () => controller.abort();
  }, [attempt]);

  async function toggle(key, enabled) {
    setSaving(key);
    setMessage(null);
    try {
      const data = await savePreferences({ disabledCategories: toggledCategories(state.data.categories, key, enabled) });
      setState({ status: 'ready', data });
      setMessage({ variant: 'success', text: 'Preferences saved.' });
    } catch (error) {
      if (error.status !== 401) setMessage({ variant: 'error', text: error.details?.disabledCategories ?? error.message });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card as="section" aria-labelledby="notification-preferences">
      <CardHeader
        title={<span id="notification-preferences">Notification preferences</span>}
        description="Choose which notifications you receive. Mandatory notices cannot be turned off."
      />
      <CardContent className="flex flex-col gap-4">
        {state.status === 'loading' && <LoadingState label="Loading preferences…" />}
        {state.status === 'error' && <ErrorState title="Preferences could not be loaded" description="Check your connection and try again." onRetry={() => setAttempt((a) => a + 1)} />}
        {message && (
          <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}
        {state.status === 'ready' && (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {preferenceRows(state.data.categories).map((row) => (
              <li key={row.key} className="flex items-start justify-between gap-4 py-3">
                <Switch
                  label={row.label}
                  description={row.locked ? `${row.description} Mandatory.` : row.description}
                  checked={row.enabled}
                  disabled={row.locked || saving !== null}
                  onChange={(next) => toggle(row.key, next)}
                />
                {row.locked && <Lock aria-hidden="true" className="mt-1 size-4 shrink-0 text-fg-muted" />}
              </li>
            ))}
          </ul>
        )}
        <p className="text-small text-fg-muted">Notifications are written in Somali and kept for 90 days.</p>
      </CardContent>
    </Card>
  );
}

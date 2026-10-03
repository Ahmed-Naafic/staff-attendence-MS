import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { settingsTabs } from '../utils/settingsOptions.js';

/** Active settings section kept in the URL (?tab=), so a section can be linked to. */
export function useSettingsTab() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = settingsTabs.some((t) => t.value === requested) ? requested : 'general';

  const setTab = useCallback(
    (value) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === 'general') next.delete('tab');
          else next.set('tab', value);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { tab, setTab };
}

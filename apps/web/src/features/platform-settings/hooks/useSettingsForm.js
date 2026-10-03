import { useCallback, useEffect, useMemo, useState } from 'react';

const EDITABLE = ['information', 'localization'];

const pick = (settings) => (settings ? Object.fromEntries(EDITABLE.map((section) => [section, { ...settings[section] }])) : null);

/**
 * Local draft of the editable General settings (Platform Information, Timezone & Localization).
 * Changes live only in this page: there is no save until settings persistence exists.
 * `discard` returns every field to the loaded values.
 */
export function useSettingsForm(settings) {
  const initial = useMemo(() => pick(settings), [settings]);
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState('');

  // A (re)load replaces the draft with the loaded values.
  useEffect(() => setDraft(initial), [initial]);

  const setField = useCallback((section, name, value) => {
    setNotice('');
    setDraft((current) => ({ ...current, [section]: { ...current[section], [name]: value } }));
  }, []);

  const changedFields = useMemo(() => {
    if (!draft || !initial) return [];
    return EDITABLE.flatMap((section) =>
      Object.keys(initial[section]).filter((name) => draft[section][name] !== initial[section][name]),
    );
  }, [draft, initial]);

  const discard = useCallback(() => {
    setDraft(initial);
    setNotice('Changes discarded. The settings show their last loaded values.');
  }, [initial]);

  return { draft, setField, changedCount: changedFields.length, isDirty: changedFields.length > 0, discard, notice };
}

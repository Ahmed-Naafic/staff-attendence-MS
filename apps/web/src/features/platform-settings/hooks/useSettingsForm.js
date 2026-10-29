import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { saveGeneral } from '../data/saveGeneral.js';
import { checkField, GENERAL_FIELDS } from '../utils/generalRules.js';

const SECTION_OF = {
  description: 'information',
  supportEmail: 'information',
  supportPhone: 'information',
  websiteUrl: 'information',
  timezone: 'localization',
  language: 'localization',
  dateFormat: 'localization',
  timeFormat: 'localization',
  firstDayOfWeek: 'localization',
};

// The editable values of the loaded General settings ('' when not set). The platform name is not here: Branding owns it.
const valuesOf = (general) => (general ? Object.fromEntries(GENERAL_FIELDS.map((key) => [key, general[SECTION_OF[key]][key] ?? ''])) : null);

/**
 * The General settings form (Platform Information, Timezone & Localization).
 * `general` is the latest saved { information, localization, conflicts, display }; `onSaved(general)`
 * receives the server's response after a successful save.
 *
 * Save sends only the fields that differ from the saved values, after checking them with the
 * approved rules (the API checks again). A stored value that breaks the rules is kept as it is
 * until the user changes that field. One save at a time; success is shown only after the server
 * confirms. Discard (after confirmation, see `requestDiscard`) returns every field to the latest
 * saved values.
 */
export function useSettingsForm(general, onSaved) {
  const saved = useMemo(() => valuesOf(general), [general]);
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  // { variant: 'success' | 'info', text }
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [saveOnce] = useState(createSingleFlight);

  // A (re)load or a save replaces the draft with the saved values.
  useEffect(() => setDraft(saved), [saved]);

  const changedKeys = useMemo(() => (draft && saved ? GENERAL_FIELDS.filter((key) => draft[key] !== saved[key]) : []), [draft, saved]);

  const setField = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
    setFormError('');
    setNotice(null);
  }, []);

  async function runSave() {
    setFormError('');
    setNotice(null);
    if (!changedKeys.length) {
      setNotice({ variant: 'info', text: 'No changes to save.' });
      return;
    }
    const body = {};
    const problems = {};
    for (const key of changedKeys) {
      const { value, problem } = checkField(key, draft[key]);
      if (problem) problems[key] = problem;
      else body[key] = value;
    }
    if (Object.keys(problems).length) {
      setErrors(problems);
      focusField(Object.keys(problems)[0]);
      return;
    }
    setSaving(true);
    try {
      const result = await saveGeneral(body);
      setErrors({});
      onSaved(result);
      setNotice({ variant: 'success', text: 'General settings saved.' });
    } catch (failure) {
      if (failure.details && Object.keys(failure.details).some((key) => GENERAL_FIELDS.includes(key))) {
        setErrors(failure.details);
        focusField(GENERAL_FIELDS.find((key) => failure.details[key]));
      } else if (failure.status === 403) {
        setFormError('Only a Super Admin can change platform settings.');
      } else if (failure.status !== 401) {
        // 401: the session ended and the app returns to the sign-in page.
        setFormError(failure.status === 0 ? failure.message : 'The settings could not be saved. Nothing was changed. Try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  const save = () => saveOnce(runSave);

  const requestDiscard = useCallback(() => setConfirmingDiscard(true), []);
  const cancelDiscard = useCallback(() => setConfirmingDiscard(false), []);
  const confirmDiscard = useCallback(() => {
    setDraft(saved);
    setErrors({});
    setFormError('');
    setConfirmingDiscard(false);
    setNotice({ variant: 'info', text: 'Changes discarded. The settings show their last saved values.' });
  }, [saved]);

  return {
    draft,
    setField,
    errors,
    formError,
    notice,
    saving,
    save,
    changedCount: changedKeys.length,
    isDirty: changedKeys.length > 0,
    confirmingDiscard,
    requestDiscard,
    cancelDiscard,
    confirmDiscard,
  };
}

function focusField(key) {
  document.querySelector(`#general-settings [name="${key}"]`)?.focus();
}

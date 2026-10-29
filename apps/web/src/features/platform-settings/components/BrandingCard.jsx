import { useEffect, useId, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { Alert, Button, Card, CardContent, CardHeader, Input } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { DEFAULT_PLATFORM_NAME, PLATFORM_NAME_MAX, nameLength, platformNameProblem } from '../../branding';
import { saveBranding } from '../data/saveBranding.js';

/**
 * Branding: the platform name shown in the sidebar, the browser tab and the sign-in page.
 * `savedName` is the stored name ('' when not set); `onSaved(name)` runs after a successful save.
 * The name is checked here first (trimmed, 1–60 characters, no control characters); the API checks
 * again. Saving the current name sends nothing. Logo and favicon uploads are not available.
 */
export function BrandingCard({ savedName, onSaved }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [value, setValue] = useState(savedName);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  // { variant: 'success' | 'info', text } shown above the form.
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);

  // A (re)load of the settings replaces the field with the stored name.
  useEffect(() => setValue(savedName), [savedName]);

  const isDirty = value.trim() !== savedName;
  const length = nameLength(value);

  function change(event) {
    setValue(event.target.value);
    setError('');
    setFormError('');
    setNotice(null);
  }

  function discard() {
    setValue(savedName);
    setError('');
    setFormError('');
    setNotice({ variant: 'info', text: 'Changes discarded.' });
  }

  function submit(event) {
    event.preventDefault();
    return saveOnce(save);
  }

  async function save() {
    setFormError('');
    setNotice(null);
    const problem = platformNameProblem(value);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    if (!isDirty) {
      setValue(savedName);
      setNotice({ variant: 'info', text: 'No changes to save.' });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveBranding(value.trim());
      onSaved(saved);
      setValue(saved);
      setNotice({ variant: 'success', text: `Platform name saved. "${saved}" is now shown across the platform.` });
    } catch (failure) {
      if (failure.details?.platformName) {
        setError(failure.details.platformName);
        inputRef.current?.focus();
      } else if (failure.status === 403) {
        setFormError('Only a Super Admin can change the platform name.');
      } else if (failure.status !== 401) {
        // 401: the session ended and the app returns to the sign-in page.
        setFormError(failure.status === 0 ? failure.message : 'The platform name could not be saved. Try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="settings-branding">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-branding">Platform Name</span>}
        description="The name shown in the sidebar, the browser tab and the sign-in page."
      />
      <CardContent className="flex flex-col gap-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        {notice && !formError && (
          <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Alert>
        )}

        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Input
            ref={inputRef}
            id={inputId}
            label="Platform name"
            required
            autoComplete="off"
            value={value}
            onChange={change}
            placeholder={DEFAULT_PLATFORM_NAME}
            error={error}
            hint={`${length} of ${PLATFORM_NAME_MAX} characters.${savedName ? '' : ` Not set: ${DEFAULT_PLATFORM_NAME} is shown.`}`}
            readOnly={saving}
          />
          <p className="text-caption text-fg-muted">Logo and favicon uploads are not available yet.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={discard} disabled={!isDirty || saving}>
              Discard Changes
            </Button>
            <Button type="submit" leftIcon={Save} loading={saving}>
              Save Branding
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

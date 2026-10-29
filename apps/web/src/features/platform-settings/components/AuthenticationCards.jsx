import { useEffect, useRef, useState } from 'react';
import { Clock, Hourglass, KeyRound, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Input, Select } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { saveAuthentication } from '../data/saveAuthentication.js';
import {
  hoursText,
  INACTIVITY_DISABLED,
  INACTIVITY_TIMEOUT_CHOICES,
  lifetimeProblem,
  minutesText,
  SESSION_LIFETIME_MAX,
  SESSION_LIFETIME_MIN,
} from '../utils/authenticationRules.js';

const sourceText = {
  setting: 'Saved in Platform Settings.',
  environment: 'Not saved here yet: the server configuration value is used.',
  default: 'Not saved here yet: the default of 12 hours is used.',
};

/**
 * Save state shared by the editable Authentication cards: field error, form error, notice, saving,
 * and one save at a time (Enter or a click during a save sends nothing more).
 * `run(values, successText)` saves and reports; it returns the saved settings or undefined.
 */
function useAuthenticationSave({ field, onSaved, focus, failureText }) {
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  // { variant: 'success' | 'info', text } shown above the form.
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);

  const clear = () => {
    setError('');
    setFormError('');
    setNotice(null);
  };

  async function run(values, successText) {
    setSaving(true);
    try {
      const next = await saveAuthentication(values);
      onSaved(next);
      setNotice({ variant: 'success', text: successText(next) });
    } catch (failure) {
      if (failure.details?.[field]) {
        setError(failure.details[field]);
        focus();
      } else if (failure.status === 403) {
        setFormError('Only a Super Admin can change authentication settings.');
      } else if (failure.status !== 401) {
        // 401: the session ended and the app returns to the sign-in page.
        setFormError(failure.status === 0 ? failure.message : failureText);
      }
    } finally {
      setSaving(false);
    }
  }

  return { error, setError, formError, notice, setNotice, saving, clear, saveOnce, run };
}

function SaveMessages({ state }) {
  return (
    <>
      {state.formError && <Alert variant="error">{state.formError}</Alert>}
      {state.notice && !state.formError && (
        <Alert variant={state.notice.variant} onDismiss={() => state.setNotice(null)}>
          {state.notice.text}
        </Alert>
      )}
    </>
  );
}

function FormActions({ isDirty, saving, onDiscard, label }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onDiscard} disabled={!isDirty || saving}>
        Discard Changes
      </Button>
      <Button type="submit" leftIcon={Save} loading={saving}>
        {label}
      </Button>
    </div>
  );
}

/**
 * Absolute session lifetime: how long a sign-in lasts, measured from sign-in. A Super Admin can
 * change it (1–72 hours, checked here and again by the API). A change applies to new sign-ins
 * only: users who are signed in keep their current expiry. Saving the value in force sends nothing.
 * `settings` is the Authentication Settings from the API; `onSaved(settings)` runs after a save.
 */
export function SessionLifetimeCard({ settings, onSaved }) {
  const inputRef = useRef(null);
  const saved = settings.sessionLifetime.hours;
  const [value, setValue] = useState(String(saved));
  const state = useAuthenticationSave({
    field: 'sessionLifetimeHours',
    onSaved,
    focus: () => inputRef.current?.focus(),
    failureText: 'The session lifetime could not be saved. Try again.',
  });

  // A (re)load or save replaces the field with the value in force.
  useEffect(() => setValue(String(saved)), [saved]);

  const isDirty = value.trim() !== String(saved);

  function change(event) {
    setValue(event.target.value);
    state.clear();
  }

  function discard() {
    setValue(String(saved));
    state.clear();
    state.setNotice({ variant: 'info', text: 'Changes discarded.' });
  }

  function submit(event) {
    event.preventDefault();
    return state.saveOnce(async () => {
      state.clear();
      const problem = lifetimeProblem(value);
      if (problem) {
        state.setError(problem);
        inputRef.current?.focus();
        return;
      }
      const hours = Number(value.trim());
      if (hours === saved) {
        setValue(String(saved));
        state.setNotice({ variant: 'info', text: 'No changes to save.' });
        return;
      }
      await state.run(
        { sessionLifetimeHours: hours },
        (next) => `Session lifetime saved: ${hoursText(next.sessionLifetime.hours)}. It applies to new sign-ins; signed-in users keep their current expiry.`,
      );
    });
  }

  return (
    <Card as="section" aria-labelledby="settings-session-lifetime">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-session-lifetime">Session Lifetime</span>}
        description="How long a sign-in lasts, measured from sign-in. Activity does not extend it."
      />
      <CardContent className="flex flex-col gap-4">
        <SaveMessages state={state} />
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Input
            ref={inputRef}
            label="Session lifetime (hours)"
            type="number"
            inputMode="numeric"
            min={SESSION_LIFETIME_MIN}
            max={SESSION_LIFETIME_MAX}
            step={1}
            required
            autoComplete="off"
            value={value}
            onChange={change}
            error={state.error}
            hint={`Whole hours from ${SESSION_LIFETIME_MIN} to ${SESSION_LIFETIME_MAX}. ${sourceText[settings.sessionLifetime.source] ?? ''}`}
            readOnly={state.saving}
          />
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-caption text-fg-secondary">
            <Clock aria-hidden="true" className="mt-px size-4 shrink-0" />
            A change applies to new sign-ins only. Users who are signed in keep their current expiry.
          </p>
          <FormActions isDirty={isDirty} saving={state.saving} onDiscard={discard} label="Save Session Lifetime" />
        </form>
      </CardContent>
    </Card>
  );
}

const toOption = (minutes) => (minutes === null ? INACTIVITY_DISABLED : String(minutes));
const fromOption = (value) => (value === INACTIVITY_DISABLED ? null : Number(value));

/**
 * Inactivity timeout: a session with no activity for this long ends, and the user signs in again.
 * Disabled (the default) or one of the approved choices (5–480 minutes; the API sends them and
 * checks again). A change applies to every session at once, including users already signed in.
 */
export function InactivityTimeoutCard({ settings, onSaved }) {
  const selectRef = useRef(null);
  const saved = settings.inactivityTimeout.minutes;
  const choices = settings.inactivityTimeout.choices ?? INACTIVITY_TIMEOUT_CHOICES;
  const [value, setValue] = useState(toOption(saved));
  const state = useAuthenticationSave({
    field: 'inactivityTimeoutMinutes',
    onSaved,
    focus: () => selectRef.current?.focus(),
    failureText: 'The inactivity timeout could not be saved. Try again.',
  });

  useEffect(() => setValue(toOption(saved)), [saved]);

  const isDirty = value !== toOption(saved);
  const options = [{ value: INACTIVITY_DISABLED, label: 'Disabled' }, ...choices.map((m) => ({ value: String(m), label: minutesText(m) }))];

  function change(event) {
    setValue(event.target.value);
    state.clear();
  }

  function discard() {
    setValue(toOption(saved));
    state.clear();
    state.setNotice({ variant: 'info', text: 'Changes discarded.' });
  }

  function submit(event) {
    event.preventDefault();
    return state.saveOnce(async () => {
      state.clear();
      if (!isDirty) {
        state.setNotice({ variant: 'info', text: 'No changes to save.' });
        return;
      }
      const minutes = fromOption(value);
      await state.run({ inactivityTimeoutMinutes: minutes }, (next) =>
        next.inactivityTimeout.enabled
          ? `Inactivity timeout saved: ${minutesText(next.inactivityTimeout.minutes)}. It applies now to every session, including users who are signed in.`
          : 'Inactivity timeout disabled. Sessions end only at their session lifetime.',
      );
    });
  }

  return (
    <Card as="section" aria-labelledby="settings-inactivity-timeout">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-inactivity-timeout">Inactivity Timeout</span>}
        description="Ends a session that has had no activity for the chosen time."
      />
      <CardContent className="flex flex-col gap-4">
        <SaveMessages state={state} />
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Select
            ref={selectRef}
            label="Inactivity timeout"
            options={options}
            value={value}
            onChange={change}
            error={state.error}
            disabled={state.saving}
            hint="Disabled by default. Activity is any action in the app; it is recorded about once a minute, so a session can end up to a minute early."
          />
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-caption text-fg-secondary">
            <Hourglass aria-hidden="true" className="mt-px size-4 shrink-0" />
            A change applies at once to every session, including users who are signed in.
          </p>
          <FormActions isDirty={isDirty} saving={state.saving} onDiscard={discard} label="Save Inactivity Timeout" />
        </form>
      </CardContent>
    </Card>
  );
}

function Fact({ icon: Icon, label, value, children }) {
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <dt className="flex items-center gap-2 text-small font-medium text-fg">
          <Icon aria-hidden="true" className="size-4 text-fg-muted" />
          {label}
        </dt>
        <dd className="text-small text-fg">{value}</dd>
      </div>
      {children && <p className="text-caption text-fg-muted">{children}</p>}
    </div>
  );
}

/**
 * Sign-in protection enforced by the server. Read only: these values are fixed in the platform
 * (the failed sign-in limit, password rules and MFA are not configurable).
 */
export function SignInSecurityCard({ settings }) {
  const { failedSignInLimit, minPasswordLength, mfa } = settings;
  return (
    <Card as="section" aria-labelledby="settings-sign-in-security">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-sign-in-security">Sign-in Security</span>}
        description="Protection the server applies to every sign-in."
      />
      <CardContent className="flex flex-col gap-4">
        <p className="rounded-md bg-muted px-3 py-2 text-caption text-fg-secondary">Read only. These values are set by the platform.</p>
        <dl className="flex flex-col divide-y divide-border-subtle">
          <Fact
            icon={ShieldAlert}
            label="Failed sign-in limit"
            value={`${failedSignInLimit.attempts} attempts in ${failedSignInLimit.windowMinutes} minutes`}
          >
            Counted per {failedSignInLimit.per}. Further attempts are refused until the period has passed.
          </Fact>
          <Fact icon={KeyRound} label="Minimum password length" value={`${minPasswordLength} characters`}>
            Applies when an account&apos;s password is set.
          </Fact>
          <Fact
            icon={ShieldCheck}
            label="Multi-factor authentication"
            value={<Badge variant="neutral">{mfa.available ? 'Available' : 'Not available'}</Badge>}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

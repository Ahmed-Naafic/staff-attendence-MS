import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal, RadioGroup } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { cancelScheduledLocation, changeLocation } from '../data/branchActions.js';
import { useCurrentPosition } from '../hooks/useCurrentPosition.js';
import { effectiveProblem, formatPosition, formatUtc, positionProblem, utcFromInput } from '../utils/branchRules.js';
import { LocationCapture } from './LocationCapture.jsx';

const WHEN = [
  { value: 'now', label: 'Now', description: 'Attendance from now on is checked against the new location.' },
  { value: 'later', label: 'From a later date and time', description: 'The current location stays in force until then.' },
];

const failure = (error) =>
  error.code === 'SCHOOL_SUSPENDED' || error.status === 404 || error.status === 0 ? error.message : 'The location could not be saved. Try again.';

/**
 * Change a branch's GPS location: capture on this device, review, confirm, and choose when it
 * takes effect (now, or a later UTC date and time — never earlier). The current location and
 * all earlier ones are kept; a change already scheduled is replaced.
 */
export function ChangeLocationModal({ branch, open, onClose, onDone }) {
  const formId = useId();
  const position = useCurrentPosition();
  const [confirmed, setConfirmed] = useState(false);
  const [when, setWhen] = useState('now');
  const [effective, setEffective] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);
  const resetPosition = position.reset;

  useEffect(() => {
    if (!open) return;
    resetPosition();
    setConfirmed(false);
    setWhen('now');
    setEffective('');
    setErrors({});
    setFormError('');
    setSaving(false);
  }, [open, resetPosition]);

  useEffect(() => setConfirmed(false), [position.position]);

  function submit(event) {
    event.preventDefault();
    return saveOnce(save);
  }

  async function save() {
    setFormError('');
    const problems = {};
    const locationProblem = positionProblem(position.position) ?? (confirmed ? null : 'Confirm that this is the branch location.');
    if (locationProblem) problems.location = locationProblem;
    if (when === 'later') {
      const timeProblem = effectiveProblem(effective);
      if (timeProblem) problems.effectiveFrom = timeProblem;
    }
    setErrors(problems);
    if (Object.keys(problems).length) {
      document.getElementById(`${formId}-${problems.location ? 'location' : 'effective'}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const { latitude, longitude, accuracy } = position.position;
      const updated = await changeLocation(branch.id, {
        latitude,
        longitude,
        accuracy,
        confirmed: true,
        effectiveFrom: when === 'now' ? 'now' : utcFromInput(effective),
      });
      setSaving(false);
      onDone(updated);
    } catch (error) {
      setSaving(false);
      if (error.details) {
        setErrors({
          location: Object.entries(error.details).find(([key]) => key !== 'effectiveFrom')?.[1],
          effectiveFrom: error.details.effectiveFrom,
        });
      } else setFormError(failure(error));
    }
  }

  const nowUtc = new Date().toISOString().slice(0, 16);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Change Branch Location"
      description={branch && `${branch.name} · ${branch.code}`}
      loading={saving}
      loadingLabel="Saving…"
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            Save Location
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {branch?.location && (
          <p className="text-small text-fg-secondary">
            Current location: <span className="tabular-nums text-fg">{formatPosition(branch.location)}</span>, in force since{' '}
            {formatUtc(branch.location.effectiveFrom)}. It is kept in the history.
          </p>
        )}
        {branch?.scheduledLocation && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
            A change to {formatPosition(branch.scheduledLocation)} is scheduled for {formatUtc(branch.scheduledLocation.effectiveFrom)}. Saving a new
            location replaces it.
          </p>
        )}
        <LocationCapture id={`${formId}-location`} capture={position} confirmed={confirmed} onConfirmedChange={setConfirmed} error={errors.location} disabled={saving} />
        <RadioGroup legend="Takes effect" options={WHEN} value={when} onChange={setWhen} disabled={saving} />
        {when === 'later' && (
          <Input
            id={`${formId}-effective`}
            type="datetime-local"
            label="Effective from (UTC)"
            required
            min={nowUtc}
            value={effective}
            onChange={(event) => {
              setEffective(event.target.value);
              if (errors.effectiveFrom) setErrors(({ effectiveFrom: _removed, ...rest }) => rest);
            }}
            error={errors.effectiveFrom}
            hint={`Times are in UTC. It is now ${formatUtc(new Date().toISOString())}. At most one year ahead; earlier times cannot be chosen.`}
          />
        )}
      </form>
    </Modal>
  );
}

/** Cancel the scheduled location change; the current location stays in force. */
export function CancelScheduledLocationModal({ branch, open, onClose, onDone }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
  }, [open]);

  async function run() {
    setError('');
    setSaving(true);
    try {
      const updated = await cancelScheduledLocation(branch.id);
      setSaving(false);
      onDone(updated);
    } catch (failed) {
      setSaving(false);
      setError(failure(failed));
    }
  }

  const scheduled = branch?.scheduledLocation;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Cancel Scheduled Location Change"
      description={branch && `${branch.name} · ${branch.code}`}
      loading={saving}
      loadingLabel="Cancelling…"
      error={error}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Keep It
          </Button>
          <Button variant="danger" onClick={() => saveOnce(run)} loading={saving}>
            Cancel Change
          </Button>
        </>
      }
    >
      {scheduled && (
        <p className="text-body text-fg-secondary">
          The change to <span className="tabular-nums text-fg">{formatPosition(scheduled)}</span> scheduled for {formatUtc(scheduled.effectiveFrom)} will
          not take effect. It stays in the history as cancelled.
        </p>
      )}
    </Modal>
  );
}

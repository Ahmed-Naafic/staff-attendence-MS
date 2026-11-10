import { useEffect, useState } from 'react';
import { Button, Modal } from '../../../components/ui';
import { formatFullDay } from '../../../lib/format.js';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { closeAcademicYear, deleteAcademicYear, startAcademicYear } from '../data/academicYears.js';

const KNOWN = ['INVALID_STATUS', 'OUT_OF_ORDER', 'CURRENT_EXISTS', 'SCHOOL_SUSPENDED', 'YEAR_CLOSED'];
const failure = (error, verb) =>
  KNOWN.includes(error.code) || error.status === 404 || error.status === 0 ? error.message : `The academic year could not be ${verb}. Try again.`;
const range = (year) => year && `${formatFullDay(year.startDate)} – ${formatFullDay(year.endDate)}`;

/** A confirmation dialog that runs `action()` once and reports `onDone(result)`. */
function Confirm({ open, onClose, onDone, title, description, confirmLabel, busyLabel, variant = 'primary', action, verb, children }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [runOnce] = useState(createSingleFlight);

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
  }, [open]);

  const run = () =>
    runOnce(async () => {
      setError('');
      setSaving(true);
      try {
        const result = await action();
        setSaving(false);
        onDone(result);
      } catch (failed) {
        setSaving(false);
        setError(failure(failed, verb));
      }
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      loading={saving}
      loadingLabel={busyLabel}
      error={error}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant={variant} onClick={run} loading={saving}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-body text-fg-secondary">{children}</div>
    </Modal>
  );
}

/** Planned → Current. When the school has a current year, it is closed in the same step. */
export function StartAcademicYearModal({ year, current, open, onClose, onDone }) {
  const replacing = current && current.id !== year?.id ? current : null;
  return (
    <Confirm
      open={open}
      onClose={onClose}
      onDone={onDone}
      title="Start Academic Year"
      description={range(year)}
      confirmLabel={replacing ? `Close ${replacing.name} and Start` : 'Start Year'}
      busyLabel="Starting…"
      verb="started"
      action={() => startAcademicYear(year.id, Boolean(replacing))}
    >
      <p>
        <strong className="text-fg">{year?.name}</strong> becomes your school’s current academic year for every branch. Branch Managers see it at once.
      </p>
      {replacing && (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
          <strong>{replacing.name}</strong> is the current year now. Starting {year?.name} closes it. A closed year is kept as it is and cannot be
          changed, restarted or deleted.
        </p>
      )}
    </Confirm>
  );
}

/** Current → Closed. Final. */
export function CloseAcademicYearModal({ year, open, onClose, onDone }) {
  return (
    <Confirm
      open={open}
      onClose={onClose}
      onDone={onDone}
      title="Close Academic Year"
      description={range(year)}
      confirmLabel="Close Year"
      busyLabel="Closing…"
      variant="danger"
      verb="closed"
      action={() => closeAcademicYear(year.id)}
    >
      <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
        <strong>{year?.name}</strong> will be closed, and your school will have no current year until you start another. Closing cannot be undone.
      </p>
    </Confirm>
  );
}

/** Deletes a planned year (one that was never started). */
export function DeleteAcademicYearModal({ year, open, onClose, onDone }) {
  return (
    <Confirm
      open={open}
      onClose={onClose}
      onDone={onDone}
      title="Delete Planned Year"
      description={range(year)}
      confirmLabel="Delete Year"
      busyLabel="Deleting…"
      variant="danger"
      verb="deleted"
      action={() => deleteAcademicYear(year.id)}
    >
      <p>
        <strong className="text-fg">{year?.name}</strong> was never started, so it can be deleted. The audit log keeps a record of it.
      </p>
    </Confirm>
  );
}

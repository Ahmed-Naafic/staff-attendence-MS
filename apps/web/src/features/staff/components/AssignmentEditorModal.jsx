import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { effectiveDateHint, effectiveTimeHint, effectiveTimeProblem, nextQuarter, whenText } from '../../schedules/utils/scheduleRules.js';
import { saveAssignments } from '../data/staffApi.js';
import { shiftsOn, toRequestAssignments, validateAssignments } from '../utils/staffRules.js';
import { ShiftDaysPicker } from './ShiftDaysPicker.jsx';

/**
 * Change a staff member's shift assignments: a complete new set from a date. Lists the branch
 * shifts of the schedule in effect on that date; ticking a shift's days assigns it. Starts from the
 * scheduled set, else the current one. `onSaved(staff)` runs after success.
 */
export function AssignmentEditorModal({ staff, open, onClose, onSaved }) {
  const formId = useId();
  const [effectiveFrom, setEffectiveFrom] = useState('');
  // With timed changes (Platform Settings) a time is chosen too; otherwise changes start at 00:00.
  const [effectiveTime, setEffectiveTime] = useState('');
  const [picked, setPicked] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);
  const info = staff?.assignments;

  useEffect(() => {
    if (!open || !staff) return;
    const base = staff.assignments.scheduled ?? staff.assignments.current;
    const start = staff.assignments.timedChanges && staff.assignments.now ? nextQuarter(staff.assignments.now) : null;
    setEffectiveFrom(start?.date ?? staff.assignments.earliestEffectiveDate);
    setEffectiveTime(start?.time ?? '');
    setPicked(Object.fromEntries((base?.shifts ?? []).map((s) => [s.shiftKey, [...s.days]])));
    setErrors({});
    setFormError('');
    setSaving(false);
  }, [open, staff]);

  const schedule = staff ? shiftsOn(staff.branchShifts, effectiveFrom, info.timedChanges ? effectiveTime : '00:00') : null;

  async function save() {
    setFormError('');
    // Only shifts of the schedule on that date can be sent; others (e.g. removed shifts) are dropped.
    const available = new Set((schedule?.shifts ?? []).map((s) => s.key));
    const kept = Object.fromEntries(Object.entries(picked).filter(([key]) => available.has(key)));
    const problems = validateAssignments({ effectiveFrom, picked: kept, schedule }, { earliest: info.earliestEffectiveDate, latest: info.latestEffectiveDate });
    const timeProblem = effectiveTimeProblem({ timed: info.timedChanges, date: effectiveFrom, time: effectiveTime, now: info.now });
    if (timeProblem) problems.effectiveTime = timeProblem;
    setErrors(problems);
    if (Object.keys(problems).length) return document.getElementById(problems.effectiveFrom || !problems.effectiveTime ? `${formId}-date` : `${formId}-time`)?.focus();
    setSaving(true);
    try {
      const updated = await saveAssignments(staff.id, { effectiveFrom, ...(info.timedChanges && { effectiveTime }), shifts: toRequestAssignments(kept) });
      setSaving(false);
      onSaved(updated);
    } catch (error) {
      setSaving(false);
      if (error.details && error.code === 'VALIDATION_ERROR') {
        setErrors(error.details);
        setFormError(Object.values(error.details)[0]);
      } else setFormError(error.code === 'BRANCH_NOT_OPERATING' || error.status === 0 ? error.message : 'The assignments could not be saved. Try again.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Change Shift Assignments"
      description={staff && `${staff.name} · ${staff.staffId}. Times are in ${info.timeZone}.`}
      loading={saving}
      loadingLabel="Saving…"
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            Save Assignments
          </Button>
        </>
      }
    >
      {staff && (
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            return saveOnce(save);
          }}
        >
          <Input
            id={`${formId}-date`}
            label="Effective from"
            type="date"
            required
            min={info.earliestEffectiveDate}
            max={info.latestEffectiveDate}
            value={effectiveFrom}
            onChange={(event) => {
              setEffectiveFrom(event.target.value);
              setErrors({});
            }}
            error={errors.effectiveFrom}
            hint={effectiveDateHint({
              first: !info.current,
              today: info.today,
              earliest: info.earliestEffectiveDate,
              delayDays: info.effectiveDelayDays,
              what: 'assignments',
              timedChanges: info.timedChanges,
            })}
          />
          {info.timedChanges && (
            <Input
              id={`${formId}-time`}
              label="Effective time"
              type="time"
              required
              value={effectiveTime}
              onChange={(event) => {
                setEffectiveTime(event.target.value);
                setErrors({});
              }}
              error={errors.effectiveTime}
              hint={effectiveTimeHint('assignments', info.timeZone)}
            />
          )}
          {info.scheduled && (
            <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
              A change is already scheduled from {whenText(info.scheduled)}. Saving replaces it (it is kept in the history as cancelled).
            </p>
          )}
          <ShiftDaysPicker
            schedule={schedule}
            picked={picked}
            onChange={(next) => {
              setPicked(next);
              setErrors({});
            }}
          />
        </form>
      )}
    </Modal>
  );
}

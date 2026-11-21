import { useEffect, useId, useState } from 'react';
import { Alert, Button, Checkbox, ErrorState, Input, Modal, RadioGroup, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { effectiveDateHint, effectiveTimeHint, effectiveTimeProblem, nextQuarter } from '../../schedules/utils/scheduleRules.js';
import { loadBulkAssignmentContext, saveAssignmentsForMany } from '../data/staffApi.js';
import { bulkTargets, shiftsOn, toRequestAssignments, validateAssignments } from '../utils/staffRules.js';
import { ShiftDaysPicker } from './ShiftDaysPicker.jsx';

/**
 * Assign shifts to many staff at once: all active staff or chosen ones, by default only those who
 * have no shifts yet. Each staff member is saved like one by one (same checks, history, notice and
 * audit); the result says who was saved, skipped or not saved and why. `onDone(result)` on close
 * after saving.
 */
export function BulkAssignmentModal({ open, onClose, onDone }) {
  const formId = useId();
  const context = useApiData(() => (open ? loadBulkAssignmentContext() : Promise.resolve(null)), `bulk|${open}`);
  const info = context.data;
  const [who, setWho] = useState('all');
  const [chosen, setChosen] = useState([]);
  const [q, setQ] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTime, setEffectiveTime] = useState('');
  const [picked, setPicked] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [saveOnce] = useState(createSingleFlight);

  useEffect(() => {
    if (!open) return;
    setWho('all');
    setChosen([]);
    setQ('');
    setOnlyUnassigned(true);
    setPicked({});
    setErrors({});
    setFormError('');
    setSaving(false);
    setResult(null);
  }, [open]);
  useEffect(() => {
    if (!info) return;
    const start = info.timedChanges && info.now ? nextQuarter(info.now) : null;
    setEffectiveFrom(start?.date ?? info.earliestEffectiveDate);
    setEffectiveTime(start?.time ?? '');
  }, [info]);

  const schedule = info ? shiftsOn(info.branchShifts, effectiveFrom, info.timedChanges ? effectiveTime : '00:00') : null;
  const targets = info ? bulkTargets(info.staff, { who, chosen, onlyUnassigned }) : [];
  const shown = (info?.staff ?? []).filter((s) => !q.trim() || `${s.name} ${s.staffId} ${s.jobTitle}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggleStaff = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const allShown = shown.length > 0 && shown.every((s) => chosen.includes(s.id));

  async function save() {
    setFormError('');
    const available = new Set((schedule?.shifts ?? []).map((s) => s.key));
    const kept = Object.fromEntries(Object.entries(picked).filter(([key]) => available.has(key)));
    const problems = validateAssignments({ effectiveFrom, picked: kept, schedule }, { earliest: info.earliestEffectiveDate, latest: info.latestEffectiveDate });
    const timeProblem = effectiveTimeProblem({ timed: info.timedChanges, date: effectiveFrom, time: effectiveTime, now: info.now });
    if (timeProblem) problems.effectiveTime = timeProblem;
    if (!targets.length) problems.staff = who === 'chosen' && !chosen.length ? 'Choose at least one staff member.' : 'Nobody to assign: everyone chosen already has shifts.';
    else if (!toRequestAssignments(kept).length) problems.shifts = 'Tick the days of at least one shift.';
    setErrors(problems);
    if (Object.keys(problems).length) return setFormError(Object.values(problems)[0]);
    setSaving(true);
    try {
      const res = await saveAssignmentsForMany({
        staff: who === 'all' ? 'all' : chosen,
        onlyUnassigned,
        effectiveFrom,
        ...(info.timedChanges && { effectiveTime }),
        shifts: toRequestAssignments(kept),
      });
      setSaving(false);
      setResult(res);
    } catch (error) {
      setSaving(false);
      if (error.details && error.code === 'VALIDATION_ERROR') {
        setErrors(error.details);
        setFormError(Object.values(error.details)[0]);
      } else setFormError(error.code === 'BRANCH_NOT_OPERATING' || error.status === 0 ? error.message : 'The shifts could not be assigned. Try again; staff already saved keep their shifts.');
    }
  }

  const failed = result?.results.filter((r) => r.result === 'failed') ?? [];
  return (
    <Modal
      open={open}
      onClose={result ? () => onDone(result) : onClose}
      size="lg"
      title="Assign Shifts to Many Staff"
      description={info ? `The same shifts and days for every staff member chosen. Times are in ${info.timeZone}.` : undefined}
      loading={saving}
      loadingLabel={`Saving ${targets.length} staff… this can take a minute.`}
      error={result ? '' : formError}
      footer={
        result ? (
          <Button onClick={() => onDone(result)}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={saving} disabled={!info}>
              {targets.length ? `Assign to ${targets.length} Staff` : 'Assign'}
            </Button>
          </>
        )
      }
    >
      {context.status === 'error' && !info && <ErrorState title="The staff could not be loaded" description={context.error?.message} onRetry={context.retry} />}
      {!info && context.status !== 'error' && <Skeleton className="h-64" />}
      {result && (
        <div className="flex flex-col gap-3">
          <Alert variant={failed.length ? 'warning' : 'success'} title={`${result.saved} saved · ${result.skipped} skipped · ${result.failed} not saved`}>
            {result.saved ? 'Saved staff are told about their new shifts. ' : ''}
            {result.skipped ? 'Skipped staff already had shifts (or are suspended) and were not changed.' : ''}
          </Alert>
          {failed.length > 0 && (
            <ul className="flex flex-col gap-1 text-small">
              {failed.map((r) => (
                <li key={r.staff.id}>
                  <span className="font-medium text-fg">{r.staff.name ?? r.staff.id}</span> {r.staff.staffId && <span className="text-fg-muted">({r.staff.staffId})</span>}: {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {info && !result && (
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            return saveOnce(save);
          }}
        >
          <RadioGroup
            legend="Staff"
            value={who}
            onChange={(value) => {
              setWho(value);
              setErrors({});
            }}
            options={[
              { value: 'all', label: `All active staff (${info.staff.length})` },
              { value: 'chosen', label: 'Choose staff' },
            ]}
          />
          {who === 'chosen' && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Input type="search" label="Find" placeholder="Name, Staff ID or job title" value={q} onChange={(e) => setQ(e.target.value)} fieldClassName="flex-1 min-w-48" />
                <Checkbox
                  label={allShown ? 'Untick all shown' : 'Tick all shown'}
                  checked={allShown}
                  onChange={() => setChosen((c) => (allShown ? c.filter((id) => !shown.some((s) => s.id === id)) : [...new Set([...c, ...shown.map((s) => s.id)])]))}
                />
              </div>
              <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1" aria-label="Staff to assign">
                {shown.map((s) => (
                  <li key={s.id}>
                    <Checkbox
                      label={`${s.name} · ${s.staffId}${s.jobTitle ? ` · ${s.jobTitle}` : ''}${s.hasShifts ? ' · has shifts' : ''}`}
                      checked={chosen.includes(s.id)}
                      onChange={() => toggleStaff(s.id)}
                    />
                  </li>
                ))}
                {!shown.length && <li className="text-small text-fg-muted">No staff match.</li>}
              </ul>
              <p className="text-small text-fg-muted">{chosen.length} chosen.</p>
            </div>
          )}
          <Checkbox
            label="Only staff who have no shifts yet"
            description={`${info.staff.filter((s) => s.hasShifts).length} staff already have shifts (now or scheduled). Untick to give everyone chosen these shifts instead (their own are replaced from the date; history is kept).`}
            checked={onlyUnassigned}
            onChange={(e) => setOnlyUnassigned(e.target.checked)}
          />
          {errors.staff && <p className="text-small text-error-fg">{errors.staff}</p>}
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
            hint={effectiveDateHint({ first: false, today: info.today, earliest: info.earliestEffectiveDate, delayDays: info.effectiveDelayDays, what: 'assignments', timedChanges: info.timedChanges })}
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
          <ShiftDaysPicker
            schedule={schedule}
            picked={picked}
            whom="the staff chosen"
            onChange={(next) => {
              setPicked(next);
              setErrors({});
            }}
          />
          {errors.shifts && <p className="text-small text-error-fg">{errors.shifts}</p>}
        </form>
      )}
    </Modal>
  );
}

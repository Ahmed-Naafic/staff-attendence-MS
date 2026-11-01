import { useEffect, useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, FieldError, Input, Modal, Switch } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { saveSchedule } from '../data/scheduleApi.js';
import { effectiveDateHint, emptyShift, MAX_SHIFTS, toRequestShifts, toRow, validateSchedule, WEEKDAYS } from '../utils/scheduleRules.js';

/**
 * Change the branch schedule: a complete new version (effective date, check-out ON/OFF and every
 * shift), starting from the version in effect (or the scheduled one, when there is one).
 * `page` is the schedule page data from the API. `onSaved(page)` runs after success.
 */
export function ScheduleEditorModal({ page, open, onClose, onSaved }) {
  const formId = useId();
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [checkOutEnabled, setCheckOutEnabled] = useState(false);
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);

  // Fresh form each time it opens, from the scheduled version, else the current one, else empty.
  useEffect(() => {
    if (!open || !page) return;
    const base = page.scheduled ?? page.current;
    setEffectiveFrom(page.earliestEffectiveDate);
    setCheckOutEnabled(base?.checkOutEnabled ?? false);
    setRows(base ? base.shifts.map(toRow) : [emptyShift()]);
    setErrors({});
    setFormError('');
    setSaving(false);
  }, [open, page]);

  const clear = (key) => errors[key] && setErrors(({ [key]: _removed, ...rest }) => rest);
  const setRow = (index, field, value) => {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
    clear(`shifts.${index}.${field}`);
  };
  const toggleDay = (index, day) => {
    const row = rows[index];
    setRow(index, 'days', row.days.includes(day) ? row.days.filter((d) => d !== day) : [...row.days, day]);
  };
  // Removing a row shifts the indexes of later errors: clear the shift errors and validate again on save.
  const removeRow = (index) => {
    setRows((current) => current.filter((_, i) => i !== index));
    setErrors(({ ...rest }) => Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith('shifts'))));
  };

  function focusFirst(problems) {
    const first = Object.keys(problems)[0];
    if (!first) return;
    const id = first === 'effectiveFrom' ? `${formId}-date` : first.startsWith('shifts.') ? `${formId}-${first.replaceAll('.', '-')}` : null;
    document.getElementById(id ?? `${formId}-shifts`)?.focus();
  }

  async function save() {
    setFormError('');
    const problems = validateSchedule({ effectiveFrom, rows }, { earliest: page.earliestEffectiveDate, latest: page.latestEffectiveDate });
    setErrors(problems);
    if (Object.keys(problems).length) {
      focusFirst(problems);
      return;
    }
    setSaving(true);
    try {
      const updated = await saveSchedule({ effectiveFrom, checkOutEnabled, shifts: toRequestShifts(rows) });
      setSaving(false);
      onSaved(updated);
    } catch (error) {
      setSaving(false);
      if (error.details && error.code === 'VALIDATION_ERROR') {
        setErrors(error.details);
        focusFirst(error.details);
      } else setFormError(error.code === 'BRANCH_NOT_OPERATING' || error.status === 0 ? error.message : 'The schedule could not be saved. Try again.');
    }
  }

  const shiftField = (index, field, props = {}) => ({
    id: `${formId}-shifts-${index}-${field}`,
    value: rows[index][field],
    onChange: (event) => setRow(index, field, event.target.value),
    error: errors[`shifts.${index}.${field}`],
    ...props,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Change Schedule"
      description={page && `Times are in ${page.timeZone}. A change saves a complete new schedule from the date you choose.`}
      loading={saving}
      loadingLabel="Saving…"
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            Save Schedule
          </Button>
        </>
      }
    >
      {page && (
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            return saveOnce(save);
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-date`}
              label="Effective from"
              type="date"
              required
              min={page.earliestEffectiveDate}
              max={page.latestEffectiveDate}
              value={effectiveFrom}
              onChange={(event) => {
                setEffectiveFrom(event.target.value);
                clear('effectiveFrom');
              }}
              error={errors.effectiveFrom}
              hint={effectiveDateHint({ first: !page.current, today: page.today, earliest: page.earliestEffectiveDate, delayDays: page.effectiveDelayDays, what: 'schedule' })}
            />
            <div className="flex items-end pb-1">
              <Switch
                label="Check-out"
                description={checkOutEnabled ? 'ON: staff check out; working hours are calculated.' : 'OFF: only check-in is recorded.'}
                checked={checkOutEnabled}
                onChange={setCheckOutEnabled}
              />
            </div>
          </div>
          {page.scheduled && (
            <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
              A change is already scheduled from {page.scheduled.effectiveFrom}. Saving replaces it (it is kept in the history as cancelled).
            </p>
          )}

          <fieldset className="flex flex-col gap-4" id={`${formId}-shifts`} tabIndex={-1}>
            <legend className="mb-2 text-label text-fg">
              Shifts <span className="text-fg-muted">(shifts on the same day cannot overlap; no overnight shifts)</span>
            </legend>
            {rows.map((row, index) => (
              // Rows have no stable id before saving; the index is the shift's identity in the form.
              <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-4">
                <div className="flex items-start gap-3">
                  <Input label="Shift name" required {...shiftField(index, 'name')} fieldClassName="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={Trash2}
                    className="mt-7"
                    onClick={() => removeRow(index)}
                    disabled={rows.length === 1}
                    aria-label={`Remove shift ${row.name || index + 1}`}
                  >
                    Remove
                  </Button>
                </div>
                <div role="group" aria-labelledby={`${formId}-days-${index}`} id={`${formId}-shifts-${index}-days`} tabIndex={-1} className="flex flex-col gap-2">
                  <span id={`${formId}-days-${index}`} className="text-label text-fg">
                    Working days
                  </span>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {WEEKDAYS.map((day) => (
                      <Checkbox key={day.value} label={day.label} checked={row.days.includes(day.value)} onChange={() => toggleDay(index, day.value)} />
                    ))}
                  </div>
                  {errors[`shifts.${index}.days`] && <FieldError id={`${formId}-days-error-${index}`}>{errors[`shifts.${index}.days`]}</FieldError>}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Input label="Start" type="time" required {...shiftField(index, 'start')} />
                  <Input label="End" type="time" required {...shiftField(index, 'end')} />
                  <Input label="Grace (min)" type="number" min={0} inputMode="numeric" required {...shiftField(index, 'graceMinutes')} />
                  <Input label="Absent after (min)" type="number" min={0} inputMode="numeric" required {...shiftField(index, 'absenceCutoffMinutes')} />
                </div>
                {errors[`shifts.${index}`] && <FieldError>{errors[`shifts.${index}`]}</FieldError>}
              </div>
            ))}
            {errors.shifts && <FieldError>{errors.shifts}</FieldError>}
            <div>
              <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => setRows((current) => [...current, emptyShift()])} disabled={rows.length >= MAX_SHIFTS}>
                Add Shift
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

import { Checkbox } from '../../../components/ui';
import { dayList, presetsFor, presetState, togglePreset, whenText, WEEKDAYS } from '../../schedules/utils/scheduleRules.js';
import { toRequestAssignments } from '../utils/staffRules.js';

/**
 * The branch shifts of a schedule version with their days to tick (and the All days / Full-time /
 * Part-time choices that fit each shift). `picked`: { shiftKey: [days] }; `onChange(next)`.
 * Used for one staff member and for many at once.
 */
export function ShiftDaysPicker({ schedule, picked, onChange, whom = 'the staff member' }) {
  const shiftDays = (shift) => WEEKDAYS.filter((d) => shift.days.includes(d.value)).map((d) => d.value);
  const toggle = (key, day) => {
    const days = picked[key] ?? [];
    onChange({ ...picked, [key]: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] });
  };
  const pickPreset = (shift, days) => onChange({ ...picked, [shift.key]: togglePreset(picked[shift.key] ?? [], days, shiftDays(shift)) });
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-label text-fg">
        Shifts {schedule && <span className="text-fg-muted">(branch schedule from {whenText(schedule)})</span>}
      </legend>
      {!schedule && <p className="text-small text-fg-muted">Your branch has no schedule in effect on this date. You can save no shifts, or set the schedule first.</p>}
      {schedule?.shifts.map((shift) => (
        <div key={shift.key} className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="text-small">
            <span className="font-medium text-fg">{shift.name}</span>{' '}
            <span className="tabular-nums text-fg-secondary">
              {shift.start}–{shift.end} · {dayList(shift.days)}
            </span>
          </p>
          {shift.days.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {presetsFor(shiftDays(shift)).map((p) => (
                <Checkbox key={p.id} label={p.id === 'all' ? `All days of ${shift.name}` : p.label} {...presetState(picked[shift.key] ?? [], p.days)} onChange={() => pickPreset(shift, p.days)} />
              ))}
            </div>
          )}
          <div role="group" aria-label={`Days for ${shift.name}`} className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAYS.filter((d) => shift.days.includes(d.value)).map((day) => (
              <Checkbox key={day.value} label={day.label} checked={(picked[shift.key] ?? []).includes(day.value)} onChange={() => toggle(shift.key, day.value)} />
            ))}
          </div>
        </div>
      ))}
      {schedule && !toRequestAssignments(picked).length && <p className="text-small text-fg-muted">No shifts ticked: {whom} will have no assigned shifts from this date.</p>}
    </fieldset>
  );
}

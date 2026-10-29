import { absentAfter, dayList, lateAfter } from '../utils/scheduleRules.js';

/** The shifts of one schedule version: days, hours, and when check-ins become late and absent. */
export function ShiftList({ shifts }) {
  return (
    <ul className="flex flex-col gap-2">
      {shifts.map((s) => (
        <li key={s.id ?? s.name} className="flex flex-col gap-1 rounded-md border border-border px-4 py-3 text-small sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col">
            <span className="font-medium text-fg">{s.name}</span>
            <span className="text-fg-secondary">{dayList(s.days)}</span>
          </div>
          <div className="flex flex-col tabular-nums sm:items-end">
            <span className="text-fg">
              {s.start}–{s.end}
            </span>
            <span className="text-fg-muted">
              Late after {lateAfter(s)} · absent if no check-in by {absentAfter(s)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

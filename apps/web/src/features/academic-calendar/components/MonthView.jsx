import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, ErrorState, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatFullDay, formatMonthYear } from '../../../lib/format.js';
import { cn } from '../../../lib/cn.js';
import { loadSchoolDays } from '../data/calendarApi.js';
import { DAY_REASONS, monthEnd, monthWeeks, shiftMonth, WEEK, WEEKDAY_NAMES, WEEKDAY_SHORT } from '../utils/calendarRules.js';

/** How a day looks: school days stand out; each reason for no school has its own style. */
const DAY_STYLES = {
  school: 'bg-success-soft text-success-fg',
  holiday: 'bg-info-soft text-info-fg',
  closure: 'bg-warning-soft text-warning-fg',
  none: 'bg-muted/40 text-fg-muted',
};
const styleOf = (day) => (day.schoolDay ? 'school' : day.reason === 'holiday' ? 'holiday' : day.reason === 'closure' ? 'closure' : 'none');

function describe(day) {
  if (day.extraDay) return `Extra school day: ${day.extraDay.name} (${WEEKDAY_NAMES[day.timetableDay]}'s timetable)`;
  if (day.schoolDay) return day.reopening ? `School day (reopened: ${day.reopening.name})` : 'School day';
  if (day.reason === 'holiday') return `School holiday: ${day.holiday.name}`;
  if (day.reason === 'closure') return `Branch closed: ${day.closure.name}`;
  return DAY_REASONS[day.reason] ?? 'No school';
}

/**
 * One month of one branch's school days, as the attendance features will see them (the server
 * decides each day: schoolDays.js). `branch` is the Owner's chosen branch; a Manager's is their own.
 */
export function MonthView({ role, branch, month, onMonthChange, version }) {
  const ready = role !== 'OWNER' || Boolean(branch);
  const { data, status, retry } = useApiData(
    () => (ready ? loadSchoolDays(role, { branch, from: `${month}-01`, to: monthEnd(month) }) : Promise.resolve(null)),
    `days|${role}|${branch}|${month}|${version}`,
  );
  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));

  return (
    <Card as="section" aria-labelledby="month-view" className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id="month-view" className="text-card-title text-fg">
            {formatMonthYear(month)}
          </h2>
          <p className="text-small text-fg-muted">
            {data ? `${data.branch.name}: ${data.schoolDays} school day${data.schoolDays === 1 ? '' : 's'} this month.` : 'School days of the branch.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" leftIcon={ChevronLeft} onClick={() => onMonthChange(shiftMonth(month, -1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" rightIcon={ChevronRight} onClick={() => onMonthChange(shiftMonth(month, 1))}>
            Next
          </Button>
        </div>
      </div>

      {!ready && <p className="text-body text-fg-secondary">Choose a branch to see its school days.</p>}
      {ready && status === 'error' && <ErrorState title="School days could not be loaded" description="Check your connection and try again." onRetry={retry} />}
      {ready && !data && status !== 'error' && <Skeleton className="h-64" />}
      {data && (
        <div role="table" aria-label={`School days, ${formatMonthYear(month)}`} className="flex flex-col gap-1">
          <div role="row" className="grid grid-cols-7 gap-1">
            {WEEK.map((d) => (
              <span key={d} role="columnheader" className="py-1 text-center text-caption font-medium text-fg-muted">
                {WEEKDAY_SHORT[d]}
              </span>
            ))}
          </div>
          {monthWeeks(month).map((week) => (
            <div role="row" key={week.find(Boolean)} className="grid grid-cols-7 gap-1">
              {week.map((date, i) => {
                const day = date && byDate.get(date);
                if (!day) return <span key={date ?? `blank-${i}`} role="cell" aria-hidden="true" className="min-h-12" />;
                const label = describe(day);
                return (
                  <span
                    key={date}
                    role="cell"
                    title={label}
                    aria-label={`${formatFullDay(date)}: ${label}`}
                    className={cn(
                      'flex min-h-12 flex-col rounded-md p-1.5 text-small tabular-nums',
                      DAY_STYLES[styleOf(day)],
                      date === data.today && 'ring-2 ring-interactive ring-offset-1',
                    )}
                  >
                    <span className="font-medium">{Number(date.slice(8))}</span>
                    <span className="hidden truncate text-caption sm:block">{day.schoolDay ? (day.extraDay ? `Extra (${WEEKDAY_SHORT[day.timetableDay]})` : day.reopening ? 'Reopened' : '') : (day.holiday?.name ?? day.closure?.name ?? '')}</span>
                  </span>
                );
              })}
            </div>
          ))}
          <ul aria-label="Legend" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-secondary">
            {[
              ['school', 'School day'],
              ['holiday', 'School holiday'],
              ['closure', 'Branch closed'],
              ['none', 'No school (weekend, outside the year, or days not set)'],
            ].map(([key, text]) => (
              <li key={key} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn('inline-block size-3 rounded-sm', DAY_STYLES[key])} />
                {text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

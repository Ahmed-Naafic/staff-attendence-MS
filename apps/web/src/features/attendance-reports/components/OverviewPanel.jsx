import { CalendarCheck, Clock3, LogIn, LogOut, TimerOff, UserCheck } from 'lucide-react';
import { BarChart } from '../../../components/charts';
import { Alert, Card, CardContent, CardHeader, KpiCard } from '../../../components/ui';
import { formatDay, formatFullDay } from '../../../lib/format.js';

const CARDS = [
  { key: 'checkIns', label: 'Check-ins', icon: LogIn, tone: 'info', note: 'Accepted check-ins' },
  { key: 'present', label: 'Present', icon: CalendarCheck, tone: 'success', note: 'Recorded as Present' },
  { key: 'late', label: 'Late', icon: Clock3, tone: 'warning', note: 'Recorded as Late' },
  { key: 'checkedOut', label: 'Checked out', icon: LogOut, tone: 'success', note: 'Check-ins with a check-out' },
  { key: 'checkOutMissing', label: 'No check-out', icon: TimerOff, tone: 'error', note: 'Check-out time has passed' },
  { key: 'staffCheckedIn', label: 'Staff checked in', icon: UserCheck, tone: 'info', note: 'Different staff members' },
];

/**
 * Overview: counts of accepted check-ins for the filters (Present and Late as stored at check-in;
 * check-out states D9) and Present / Late by day. No rates, percentages, scheduled totals or absence
 * (D19, D20): absence is not calculated yet.
 */
export function OverviewPanel({ summary }) {
  const { totals, byDay } = summary;
  const labelEvery = Math.max(1, Math.ceil(byDay.length / 10));
  const chart = (key) => byDay.map((d) => ({ label: formatDay(d.date), fullLabel: formatFullDay(d.date), value: d[key] }));
  // Counts are whole numbers: with small values, use fewer axis ticks so none repeat (e.g. 0, 1, 2).
  const ticks = (key) => Math.min(4, Math.max(1, ...byDay.map((d) => d[key])));
  const extra = [
    totals.checkOutOpen > 0 && `${totals.checkOutOpen.toLocaleString()} not checked out yet (a check-out can still be recorded or uploaded)`,
    totals.checkOutNotRequired > 0 && `${totals.checkOutNotRequired.toLocaleString()} on days when check-out was not required`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info" title="Absence is not calculated yet">
        These figures count recorded check-ins and check-outs only. Days without a check-in are not counted as absent.
      </Alert>
      <ul aria-label="Attendance summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => (
          <KpiCard key={card.key} label={card.label} icon={card.icon} tone={card.tone} value={totals[card.key]} note={card.note} />
        ))}
      </ul>
      {extra.length > 0 && <p className="text-small text-fg-secondary">Also: {extra.join('; ')}.</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Present by day" description="Check-ins recorded as Present" />
          <CardContent className="pt-4">
            <BarChart data={chart('present')} label="Present check-ins by day" color="var(--color-success)" labelEvery={labelEvery} ticks={ticks('present')} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Late by day" description="Check-ins recorded as Late" />
          <CardContent className="pt-4">
            <BarChart data={chart('late')} label="Late check-ins by day" color="var(--color-warning)" labelEvery={labelEvery} ticks={ticks('late')} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

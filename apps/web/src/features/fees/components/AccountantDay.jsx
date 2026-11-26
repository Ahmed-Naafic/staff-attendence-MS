import { AlertTriangle, Banknote, ChevronRight, ClipboardCheck, Lock, RefreshCcw, Scale } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardHeader, ErrorState, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadMyClosing } from '../data/feeApi.js';
import { CLOSING_RESULT, dateTimeText, money } from '../utils/feeFormat.js';
import { Stat, StatRow } from './FeeShell.jsx';

/**
 * The Accountant's own day at the top of the Fee overview: the cash they hold since their last closing
 * (GET /fees/closings/mine, their own payments only), whether they have closed today, their last
 * closing, and what is waiting for them. The branch figures follow below, as for Managers.
 * overview: the overview response (overdue students, the monthly generation state).
 */
export function AccountantDay({ role, currency, overview, version }) {
  const mine = useApiData(() => loadMyClosing(role), `my-closing|${version}`);
  if (mine.status === 'error' && !mine.data) return <ErrorState title="Your cash could not be loaded" onRetry={mine.retry} />;
  if (!mine.data) return <Skeleton className="h-24 w-full" />;
  const { open, closedToday, recent } = mine.data;
  const last = recent[0];
  const holding = open.paymentsCount > 0 || open.reversalsCount > 0;
  const closing = closedToday && !holding ? { label: 'Closed', tone: 'success' } : holding ? { label: 'Not closed', tone: 'warning' } : { label: 'Nothing to close', tone: 'info' };
  const lastMonth = overview?.generation?.months?.at(-1);

  const tasks = [
    holding && { key: 'close', icon: Lock, tone: 'text-warning-fg', to: '/fees/cash-closing', text: `Close your cash: ${money(open.expectedAmount, currency)} expected from ${open.paymentsCount} payment${open.paymentsCount === 1 ? '' : 's'}` },
    overview?.overdueCount > 0 && { key: 'overdue', icon: AlertTriangle, tone: 'text-error-fg', to: '/fees/students?status=overdue', text: `${overview.overdueCount} student${overview.overdueCount === 1 ? '' : 's'} with overdue fees` },
    lastMonth && lastMonth.status !== 'succeeded' && { key: 'generation', icon: RefreshCcw, tone: 'text-warning-fg', to: '/fees', text: `Monthly fees of ${lastMonth.label}: ${lastMonth.status === 'failed' ? 'generation failed' : 'not generated yet'}` },
  ].filter(Boolean);

  return (
    <section aria-label="Your cash" className="flex flex-col gap-3">
      <StatRow>
        <Stat icon={Banknote} tone="accent" label="Cash to close" value={money(open.expectedAmount, currency)} note={open.since ? `Since your closing of ${dateTimeText(open.since)}` : 'All the cash you have recorded'} />
        <Stat icon={ClipboardCheck} tone="info" label="Payments not closed" value={open.paymentsCount.toLocaleString()} note={open.reversalsCount ? `${open.reversalsCount} reversal${open.reversalsCount === 1 ? '' : 's'} (${money(open.reversedAmount, currency)})` : `${money(open.recordedAmount, currency)} recorded by you`} />
        <Stat icon={Lock} tone={closing.tone} label="Cash closing today" value={closing.label} note={mine.data.today} />
        <Stat
          icon={Scale}
          tone={last ? (last.result === 'balanced' ? 'success' : last.result === 'shortage' ? 'error' : 'warning') : 'info'}
          label="Your last closing"
          value={last ? CLOSING_RESULT[last.result].label : 'None yet'}
          note={last ? `${dateTimeText(last.closedAt)}${last.difference ? ` · ${money(Math.abs(last.difference), currency)}` : ''}` : 'Close your cash at the end of the day'}
        />
      </StatRow>
      <Card>
        <CardHeader title="Your pending tasks" />
        <ul className="divide-y divide-border-subtle px-5 pb-2 text-small">
          {!tasks.length && <li className="py-3 text-fg-muted">Nothing is waiting for you.</li>}
          {tasks.map((t) => (
            <li key={t.key}>
              <Link to={t.to} className="flex items-center gap-3 py-2.5 text-fg hover:text-interactive">
                <t.icon aria-hidden="true" className={`size-4 shrink-0 ${t.tone}`} />
                <span className="flex-1">{t.text}</span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

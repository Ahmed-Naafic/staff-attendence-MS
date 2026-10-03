import { Building2, CalendarCheck, ClipboardList, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { KpiCard } from '../../../components/ui';
import { isSecurityEvent } from '../utils/auditTypes.js';

const DAY = 24 * 60 * 60 * 1000;

const startOfToday = (now) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Counts for the whole log (not affected by search or filters). */
function summarise(events, now) {
  const today = startOfToday(now);
  const at = (e) => new Date(e.occurredAt).getTime();
  const count = (test) => events.filter(test).length;
  return {
    total: events.length,
    lastWeek: count((e) => at(e) >= now - 7 * DAY),
    today: count((e) => at(e) >= today),
    yesterday: count((e) => at(e) >= today - DAY && at(e) < today),
    admin: count((e) => e.actor.role === 'SUPER_ADMIN' && !isSecurityEvent(e)),
    school: count((e) => e.target.type === 'school'),
    owner: count((e) => e.actor.role === 'OWNER' && !isSecurityEvent(e)),
    security: count(isSecurityEvent),
    failed: count((e) => isSecurityEvent(e) && e.result === 'failure'),
  };
}

/**
 * Six key figures. No change percentages: they would compare demo periods of very different
 * sizes, so each card states what it counts instead.
 */
export function AuditSummary({ events, now = Date.now() }) {
  const s = summarise(events, now);
  const cards = [
    { key: 'total', label: 'Total Logs', icon: ClipboardList, tone: 'info', value: s.total, note: `${s.lastWeek} in the last 7 days` },
    { key: 'today', label: "Today's Logs", icon: CalendarCheck, tone: 'success', value: s.today, note: `${s.yesterday} yesterday` },
    { key: 'admin', label: 'Admin Actions', icon: ShieldCheck, tone: 'warning', value: s.admin, note: 'By Super Admins' },
    { key: 'school', label: 'School Actions', icon: Building2, tone: 'success', value: s.school, note: 'On school records' },
    { key: 'owner', label: 'Owner Actions', icon: UserRound, tone: 'warning', value: s.owner, note: 'By school owners' },
    { key: 'security', label: 'Security Events', icon: ShieldAlert, tone: 'error', value: s.security, note: `${s.failed} failed` },
  ];

  return (
    <section aria-labelledby="audit-summary">
      <h2 id="audit-summary" className="sr-only">
        Summary
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {cards.map(({ key, ...card }) => (
          <KpiCard key={key} {...card} />
        ))}
      </ul>
    </section>
  );
}

import { Building2, CalendarCheck, ClipboardList, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { KpiCard } from '../../../components/ui';
/**
 * Six key figures for the whole log (not affected by search or filters), counted by the server.
 * No change percentages: each card states what it counts instead.
 * Admin / Owner Actions exclude sign-ins, sign-outs and password changes (Security Events).
 */
export function AuditSummary({ summary: s }) {
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

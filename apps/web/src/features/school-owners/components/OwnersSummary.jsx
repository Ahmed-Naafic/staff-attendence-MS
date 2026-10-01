import { CircleOff, Clock, UserRoundCheck, Users } from 'lucide-react';
import { KpiCard } from '../../../components/ui';

const cards = [
  { key: 'totalOwners', label: 'Total Owners', icon: Users, tone: 'info', count: (o) => o.length },
  { key: 'activeOwners', label: 'Active Owners', icon: UserRoundCheck, tone: 'success', count: (o) => o.filter((x) => x.status === 'active').length },
  { key: 'pendingOwners', label: 'Pending Owners', icon: Clock, tone: 'warning', count: (o) => o.filter((x) => x.status === 'pending').length },
  { key: 'suspendedOwners', label: 'Suspended Owners', icon: CircleOff, tone: 'error', count: (o) => o.filter((x) => x.status === 'suspended').length },
];

/** Four summary figures for the whole platform (not affected by search or filters). */
export function OwnersSummary({ owners, summary }) {
  return (
    <section aria-labelledby="owners-summary">
      <h2 id="owners-summary" className="sr-only">
        Summary
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <KpiCard
            key={card.key}
            label={card.label}
            icon={card.icon}
            tone={card.tone}
            value={card.count(owners)}
            changePercent={summary[card.key]?.changePercent}
            trend={summary[card.key]?.trend}
          />
        ))}
      </ul>
    </section>
  );
}

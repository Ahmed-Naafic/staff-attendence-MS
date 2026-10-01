import { Building2, CircleOff, Clock, Landmark } from 'lucide-react';
import { KpiCard } from '../../../components/ui';

const cards = [
  { key: 'totalSchools', label: 'Total Schools', icon: Landmark, tone: 'info', count: (s) => s.length },
  { key: 'activeSchools', label: 'Active Schools', icon: Building2, tone: 'success', count: (s) => s.filter((x) => x.status === 'active').length },
  { key: 'pendingSchools', label: 'Pending Approval', icon: Clock, tone: 'warning', count: (s) => s.filter((x) => x.status === 'pending').length },
  { key: 'suspendedSchools', label: 'Suspended Schools', icon: CircleOff, tone: 'error', count: (s) => s.filter((x) => x.status === 'suspended').length },
];

/** Four summary figures for the whole platform (not affected by search or filters). */
export function SchoolsSummary({ schools, summary }) {
  return (
    <section aria-labelledby="schools-summary">
      <h2 id="schools-summary" className="sr-only">
        Summary
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <KpiCard
            key={card.key}
            label={card.label}
            icon={card.icon}
            tone={card.tone}
            value={card.count(schools)}
            changePercent={summary[card.key]?.changePercent}
            trend={summary[card.key]?.trend}
          />
        ))}
      </ul>
    </section>
  );
}

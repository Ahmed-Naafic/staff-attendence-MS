import { Building2, CircleOff, Clock, Landmark } from 'lucide-react';
import { KpiCard } from '../../../components/ui';

const cards = [
  { key: 'total', label: 'Total Schools', icon: Landmark, tone: 'info' },
  { key: 'active', label: 'Active Schools', icon: Building2, tone: 'success' },
  { key: 'pending', label: 'Pending Approval', icon: Clock, tone: 'warning' },
  { key: 'suspended', label: 'Suspended Schools', icon: CircleOff, tone: 'error' },
];

/**
 * Four summary figures for the whole platform (not affected by search or filters), counted by
 * the server. No change percentages: comparing periods needs an approved definition.
 */
export function SchoolsSummary({ counts }) {
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
            value={counts[card.key]}
          />
        ))}
      </ul>
    </section>
  );
}

import { CircleOff, UserRoundCheck, Users } from 'lucide-react';
import { KpiCard } from '../../../components/ui';

const cards = [
  { key: 'total', label: 'Total Owners', icon: Users, tone: 'info' },
  { key: 'active', label: 'Active Owners', icon: UserRoundCheck, tone: 'success' },
  { key: 'suspended', label: 'Suspended Owners', icon: CircleOff, tone: 'error' },
];

/**
 * Three summary figures for the whole platform (not affected by search or filters), counted by
 * the server. No change percentages: comparing periods needs an approved definition.
 */
export function OwnersSummary({ counts }) {
  return (
    <section aria-labelledby="owners-summary">
      <h2 id="owners-summary" className="sr-only">
        Summary
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

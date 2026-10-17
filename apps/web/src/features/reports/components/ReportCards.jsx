import { Building2, ChartColumn, ChartPie, CircleOff, Landmark, MapPin, UserCheck, UserX, Users } from 'lucide-react';
import { BarChart, DonutChart } from '../../../components/charts';
import { Card, CardContent, CardHeader, EmptyState, KpiCard } from '../../../components/ui';
import { formatDay, formatFullDay, formatMonth, formatMonthYear } from '../../../lib/format.js';

// Colors per status (ACTIVE and SUSPENDED only).
const statusColors = { active: 'var(--color-interactive)', suspended: 'var(--color-error)' };
const statusLabels = { active: 'Active', suspended: 'Suspended' };

export const UNKNOWN_CITY = 'Unknown';

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const summaryCards = {
  schools: [
    { key: 'total', label: 'Total Schools', icon: Landmark, tone: 'info' },
    { key: 'active', label: 'Active Schools', icon: Building2, tone: 'success' },
    { key: 'suspended', label: 'Suspended Schools', icon: CircleOff, tone: 'error' },
  ],
  owners: [
    { key: 'total', label: 'Total Owners', icon: Users, tone: 'info' },
    { key: 'active', label: 'Active Owners', icon: UserCheck, tone: 'success' },
    { key: 'suspended', label: 'Suspended Owners', icon: UserX, tone: 'error' },
  ],
};

/** Total / Active / Suspended for schools or owners. Current counts (not limited to the trend period). */
export function SummaryCards({ kind, summary }) {
  return (
    <ul aria-label={kind === 'schools' ? 'School summary' : 'Owner summary'} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {summaryCards[kind].map((card) => (
        <KpiCard key={card.key} label={card.label} icon={card.icon} tone={card.tone} value={summary[card.key]} />
      ))}
    </ul>
  );
}

/** Status distribution: donut plus a legend that states every count (the accessible version). */
export function StatusDistributionCard({ title, summary, unit, emptyTitle, emptyDescription }) {
  const rows = ['active', 'suspended'].map((key) => ({ key, label: statusLabels[key], color: statusColors[key], value: summary[key] }));
  const total = rows.reduce((n, row) => n + row.value, 0);

  return (
    <Card className="h-full">
      <CardHeader title={title} description="Current status" />
      <CardContent className="pt-5">
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <DonutChart segments={rows} centerValue={total} centerLabel={`Total ${unit}`} size={124} thickness={18} />
            <ul aria-label={`${title}: ${plural(total, unit.replace(/s$/, ''), unit)}`} className="flex min-w-36 flex-1 flex-col gap-2.5">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2.5 text-small">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill" style={{ backgroundColor: row.color }} />
                  <span className="flex-1 text-fg-secondary">{row.label}</span>
                  <span className="font-semibold text-fg tabular-nums">
                    {row.value.toLocaleString()}
                    <span className="sr-only"> {unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState compact icon={ChartPie} title={emptyTitle} description={emptyDescription} />
        )}
      </CardContent>
    </Card>
  );
}

/** Schools per city, most first (ties A–Z); schools without a city are listed as "Unknown". */
export function SchoolsByCityCard({ cities, isFiltered }) {
  const max = Math.max(1, ...cities.map((c) => c.count));
  return (
    <Card className="h-full">
      <CardHeader title="Schools by City" description="Current, most schools first" />
      <CardContent>
        {cities.length === 0 ? (
          <EmptyState
            compact
            icon={MapPin}
            title={isFiltered ? 'No schools match these filters' : 'No schools yet'}
            description={isFiltered ? 'Try another status or city.' : 'Cities appear once schools are registered.'}
          />
        ) : (
          <ol aria-label="Schools by city" className="flex flex-col gap-3">
            {cities.map((row, index) => (
              <li key={row.city ?? UNKNOWN_CITY} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-small">
                  <span className="flex min-w-0 items-center gap-2 text-fg">
                    <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" />
                    <span className={row.city === null ? 'truncate text-fg-muted italic' : 'truncate'}>{row.city ?? UNKNOWN_CITY}</span>
                  </span>
                  <span className="font-semibold text-fg tabular-nums">
                    {row.count.toLocaleString()}
                    <span className="sr-only"> {row.count === 1 ? 'school' : 'schools'}</span>
                  </span>
                </div>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-pill bg-muted">
                  <span
                    className="block h-full rounded-pill"
                    style={{ width: `${(row.count / max) * 100}%`, backgroundColor: index === 0 ? 'var(--color-accent)' : 'var(--color-chart-1)' }}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Axis label, full label, and a readable range for trend keys ('YYYY-MM-DD' or 'YYYY-MM'). */
const formatters = {
  day: { short: formatDay, full: formatFullDay },
  month: { short: formatMonth, full: formatMonthYear },
};
export const trendRange = (trend, unit) => `${formatters[unit].full(trend[0].key)} – ${formatters[unit].full(trend.at(-1).key)}`;

/** Records created per day or month in the trend period (zero days / months included). */
export function CreationTrendCard({ title, trend, unit, noun, emptyTitle, color }) {
  const per =unit === 'day' ? 'day' : 'month';
  const range = trendRange(trend, unit);
  const data = trend.map((p) => ({ label: formatters[unit].short(p.key), fullLabel: formatters[unit].full(p.key), value: p.count }));

  return (
    <Card className="h-full">
      <CardHeader title={title} description={`${noun} created per ${per}, ${range}`} />
      <CardContent className="pt-5">
        {trend.some((p) => p.count > 0) ? (
          <BarChart
            label={`${noun} created per ${per}, ${range}`}
            data={data}
            color={color}
            // Whole-number ticks for small counts (e.g. 1 → 0, 1 rather than 0, 0.25 … rounded).
            ticks={Math.min(4, Math.max(...trend.map((p) => p.count)))}
            labelEvery={trend.length > 12 ? 7 : 1}
          />
        ) : (
          <EmptyState compact icon={ChartColumn} title={emptyTitle} description={`Nothing was created between ${range}.`} />
        )}
      </CardContent>
    </Card>
  );
}

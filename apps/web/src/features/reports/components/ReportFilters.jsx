import { Button, Card, Select } from '../../../components/ui';
import { periods, schoolStatusOptions } from '../data/reportOptions.js';

/**
 * Report filters (applied by the API). The trend period affects both creation trends; school
 * status and city affect every school report and no owner report.
 */
export function ReportFilters({ filters, cities, onChange, onReset, isFiltered }) {
  // Keep a city from the URL selectable even if no school uses it any more (it then shows no schools).
  const cityChoices = filters.city && !cities.includes(filters.city) ? [...cities, filters.city] : cities;

  return (
    <Card as="section" aria-labelledby="report-filters-title" className="p-4">
      <h2 id="report-filters-title" className="sr-only">
        Report filters
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Select
          label="Trend period"
          hint="Both creation trends"
          options={periods}
          value={filters.period}
          onChange={(event) => onChange('period', event.target.value)}
        />
        <Select
          label="School status"
          hint="School reports"
          options={schoolStatusOptions}
          value={filters.status}
          onChange={(event) => onChange('status', event.target.value)}
        />
        <Select
          label="City"
          hint="School reports"
          options={[{ value: '', label: 'All cities' }, ...cityChoices.map((c) => ({ value: c, label: c }))]}
          value={filters.city}
          onChange={(event) => onChange('city', event.target.value)}
        />
        <Button variant="outline" onClick={onReset} disabled={!isFiltered} className="sm:col-span-2 lg:col-span-1 lg:mb-6">
          Reset
        </Button>
      </div>
    </Card>
  );
}

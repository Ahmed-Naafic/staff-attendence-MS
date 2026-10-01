import { Button, Card, Input, Select } from '../../../components/ui';
import { registeredRanges } from '../utils/filterOwners.js';
import { ownerStatuses } from './OwnerStatusBadge.jsx';

const statusOptions = [
  { value: '', label: 'All statuses' },
  ...Object.entries(ownerStatuses).map(([value, status]) => ({ value, label: status.label })),
];

/** Search, status / location / registration-date filters and Reset. */
export function OwnersFilters({ filters, locations, onChange, onReset, isFiltered }) {
  return (
    <Card as="section" aria-label="Search and filter school owners" className="p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))_auto]">
        <Input
          type="search"
          label="Search school owners"
          hideLabel
          placeholder="Search owners by name, email, or school…"
          value={filters.query}
          onChange={(event) => onChange('query', event.target.value)}
          fieldClassName="md:col-span-2 xl:col-span-1"
        />
        <Select
          label="Status"
          hideLabel
          options={statusOptions}
          value={filters.status}
          onChange={(event) => onChange('status', event.target.value)}
        />
        <Select
          label="Location"
          hideLabel
          options={[{ value: '', label: 'All locations' }, ...locations.map((l) => ({ value: l, label: l }))]}
          value={filters.location}
          onChange={(event) => onChange('location', event.target.value)}
        />
        <Select
          label="Registration date"
          hideLabel
          options={registeredRanges}
          value={filters.registered}
          onChange={(event) => onChange('registered', event.target.value)}
        />
        <Button variant="outline" onClick={onReset} disabled={!isFiltered} className="md:col-span-2 xl:col-span-1">
          Reset
        </Button>
      </div>
    </Card>
  );
}

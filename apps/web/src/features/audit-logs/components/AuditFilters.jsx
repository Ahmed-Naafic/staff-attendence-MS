import { Button, Card, Input, Select } from '../../../components/ui';
import { auditActions, auditResults } from '../utils/auditTypes.js';
import { dateRanges } from '../utils/filterAuditLogs.js';

const actionOptions = [
  { value: '', label: 'All actions' },
  ...Object.entries(auditActions).map(([value, action]) => ({ value, label: action.label })),
];
const statusOptions = [
  { value: '', label: 'All statuses' },
  ...Object.entries(auditResults).map(([value, result]) => ({ value, label: result.label })),
];

/** Search, action / user / school / status / date filters and Reset. A custom date range adds From and To. */
export function AuditFilters({ filters, users, schools, dateError, onChange, onReset, isFiltered }) {
  return (
    <Card as="section" aria-label="Search and filter audit logs" className="gap-3 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto]">
        <Input
          type="search"
          label="Search audit logs"
          hideLabel
          placeholder="Search by action, user, school, or details…"
          value={filters.query}
          onChange={(event) => onChange('query', event.target.value)}
          fieldClassName="md:col-span-2 xl:col-span-1"
        />
        <Select
          label="Action"
          hideLabel
          options={actionOptions}
          value={filters.action}
          onChange={(event) => onChange('action', event.target.value)}
        />
        <Select
          label="User"
          hideLabel
          options={[{ value: '', label: 'All users' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          value={filters.user}
          onChange={(event) => onChange('user', event.target.value)}
        />
        <Select
          label="School"
          hideLabel
          options={[{ value: '', label: 'All schools' }, ...schools.map((s) => ({ value: s.id, label: s.name }))]}
          value={filters.school}
          onChange={(event) => onChange('school', event.target.value)}
        />
        <Select
          label="Status"
          hideLabel
          options={statusOptions}
          value={filters.status}
          onChange={(event) => onChange('status', event.target.value)}
        />
        <Select
          label="Date range"
          hideLabel
          options={dateRanges}
          value={filters.date}
          onChange={(event) => onChange('date', event.target.value)}
        />
        <Button variant="outline" onClick={onReset} disabled={!isFiltered} className="md:col-span-2 xl:col-span-1">
          Reset
        </Button>
      </div>

      {filters.date === 'custom' && (
        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:w-[32rem]">
          <legend className="sr-only">Custom date range</legend>
          <Input
            type="date"
            label="From"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => onChange('from', event.target.value)}
          />
          <Input
            type="date"
            label="To"
            value={filters.to}
            min={filters.from || undefined}
            error={dateError}
            onChange={(event) => onChange('to', event.target.value)}
          />
        </fieldset>
      )}
    </Card>
  );
}

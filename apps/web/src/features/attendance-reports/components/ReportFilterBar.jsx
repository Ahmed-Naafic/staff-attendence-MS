import { Button, Card, Input, Select } from '../../../components/ui';
import { MAX_DAYS, RANGE_PRESETS } from '../utils/reportRules.js';

const statusLabel = (status) => (status === 'suspended' ? ' (suspended)' : '');

/**
 * Report filters, applied by the API: dates (presets from the server's today, or custom dates —
 * inclusive, at most 62 days), branch (Owner), staff (search, then choose), shift (Manager; Owner only
 * with one branch: D16). The page states the time zone used.
 */
export function ReportFilterBar({ role, view, update, reset, filtered, today, options, rangeErrors, staffQuery, onStaffQuery }) {
  const owner = role === 'OWNER';
  const branches = options?.branches ?? [];
  const staff = options?.staff ?? [];
  const shifts = options?.shifts ?? [];
  // Keep the chosen staff member or shift selectable even when the current search does not list them.
  const staffChoices = view.staff && !staff.some((s) => s.id === view.staff) ? [{ id: view.staff, name: 'Selected staff member', staffId: '' }, ...staff] : staff;
  const shiftChoices = view.shift && !shifts.some((s) => s.key === view.shift) ? [{ key: view.shift, name: 'Selected shift', start: '', end: '' }, ...shifts] : shifts;
  const showShift = !owner || Boolean(view.branch);

  return (
    <Card as="section" aria-labelledby="attendance-filters-title" className="p-4">
      <h2 id="attendance-filters-title" className="sr-only">
        Report filters
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Dates"
          options={RANGE_PRESETS}
          value={view.range}
          onChange={(event) => {
            const range = event.target.value;
            // Custom starts from today's date so the inputs are never empty.
            update(range === 'custom' ? { range, from: view.from || today || '', to: view.to || today || '' } : { range });
          }}
        />
        {view.range === 'custom' && (
          <>
            <Input type="date" label="From" value={view.from} max={today ?? undefined} error={rangeErrors.from} onChange={(event) => update({ from: event.target.value })} />
            <Input type="date" label="To" value={view.to} max={today ?? undefined} error={rangeErrors.to} hint={`Both dates included, at most ${MAX_DAYS} days.`} onChange={(event) => update({ to: event.target.value })} />
          </>
        )}
        {owner && (
          <Select
            label="Branch"
            options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})${statusLabel(b.status)}` }))]}
            value={view.branch}
            onChange={(event) => update({ branch: event.target.value, staff: '' })}
          />
        )}
        <div className="flex flex-col gap-2">
          <Input type="search" label="Find staff" placeholder="Name or Staff ID…" value={staffQuery} onChange={(event) => onStaffQuery(event.target.value)} />
          <Select
            label="Staff member"
            hideLabel
            options={[{ value: '', label: 'All staff' }, ...staffChoices.map((s) => ({ value: s.id, label: `${s.name}${s.staffId ? ` · ${s.staffId}` : ''}${statusLabel(s.status)}` }))]}
            value={view.staff}
            onChange={(event) => update({ staff: event.target.value })}
          />
        </div>
        {showShift ? (
          <Select
            label="Shift"
            options={[{ value: '', label: 'All shifts' }, ...shiftChoices.map((s) => ({ value: s.key, label: s.start ? `${s.name} (${s.start}–${s.end})` : s.name }))]}
            value={view.shift}
            onChange={(event) => update({ shift: event.target.value })}
          />
        ) : (
          <p className="self-end pb-2 text-small text-fg-muted">Choose a branch to filter by shift.</p>
        )}
        <Button variant="outline" onClick={reset} disabled={!filtered} className="self-end">
          Reset
        </Button>
      </div>
    </Card>
  );
}

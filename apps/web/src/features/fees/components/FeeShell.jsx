import { Wallet } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Badge, Card, EmptyState, ErrorState, Input, LoadingState, Select } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { useSession } from '../../auth';
import { loadFeeStatus } from '../data/feeApi.js';
import { money } from '../utils/feeFormat.js';

/** The account's role for the fee API: OWNER, MANAGER or ACCOUNTANT. */
export function useFeeRole() {
  const { user } = useSession();
  return ['OWNER', 'MANAGER', 'ACCOUNTANT'].includes(user.role) ? user.role : 'MANAGER';
}

/**
 * Every Fee Management page: the header, then the page only when the module is switched on for the
 * school; otherwise a clear explanation. `children(status, retry)` gets the role's permissions,
 * currency, years, branches, classes and sections.
 */
export function FeePage({ title, description, primaryAction, secondaryActions, children }) {
  const role = useFeeRole();
  const status = useApiData(() => loadFeeStatus(role), `fee-status|${role}`);
  const on = status.data?.featureEnabled;
  return (
    <PageContainer>
      <PageHeader title={title} description={description} primaryAction={on ? primaryAction?.(status.data) : undefined} secondaryActions={on ? secondaryActions?.(status.data) : undefined} />
      {status.status === 'error' && !status.data ? (
        <ErrorState title="Fee Management could not be loaded" description="Check your connection and try again." onRetry={status.retry} />
      ) : !status.data ? (
        <LoadingState label="Loading fees…" />
      ) : !on ? (
        <Card className="p-2">
          <EmptyState icon={Wallet} title="Fee Management is not switched on for your school" description="Monthly fees, payments and receipts, invoices, discounts, fee clearance, cash closing and fee reports become available once EduTrack support switches Fee Management on for your school." />
        </Card>
      ) : (
        children(status.data, status.retry)
      )}
    </PageContainer>
  );
}

/** An amount in the school's currency, tabular. */
export const Money = ({ value, currency, className = '' }) => <span className={`tabular-nums ${className}`}>{money(value, currency)}</span>;

/** A status badge from a { key: { label, variant } } map. */
export const StatusBadge = ({ map, value }) => <Badge variant={map[value]?.variant ?? 'neutral'}>{map[value]?.label ?? value}</Badge>;

/** A figure tile: icon, value, label (the reference layout's KPI row). */
export function Stat({ icon: Icon, label, value, tone = 'info', note }) {
  const tones = { info: 'bg-info-soft text-info-fg', success: 'bg-success-soft text-success-fg', warning: 'bg-warning-soft text-warning-fg', error: 'bg-error-soft text-error-fg', accent: 'bg-accent-soft text-accent-fg' };
  return (
    <Card as="li" className="flex-row items-center gap-3 p-4">
      {Icon && (
        <span className={`grid size-11 shrink-0 place-items-center rounded-md ${tones[tone] ?? tones.info}`}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-section-title tabular-nums text-fg">{value}</p>
        <p className="truncate text-small text-fg-muted">{label}</p>
        {note && <p className="truncate text-caption text-fg-muted">{note}</p>}
      </div>
    </Card>
  );
}

export const StatRow = ({ children, cols = 4 }) => <ul className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${cols >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'}`}>{children}</ul>;

/**
 * The shared filters: academic year, branch (School Owner), class, section, a date range and extra
 * controls. `value` is the filter object, `onChange(next)` replaces it; `show` picks the controls.
 */
export function FeeFilters({ status, value, onChange, show = ['academicYear', 'branch', 'class', 'section'], children }) {
  const set = (k, v) => onChange({ ...value, [k]: v, ...(k === 'class' ? { section: '' } : {}), ...(k === 'branch' ? { section: '' } : {}), page: 1 });
  const sections = status.sections.filter((s) => (!value.class || s.classId === value.class) && (!value.branch || s.branchId === value.branch));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {show.includes('academicYear') && (
        <Select label="Academic year" size="sm" value={value.academicYear ?? ''} onChange={(e) => set('academicYear', e.target.value)} options={[{ value: '', label: 'Current year' }, ...status.academicYears.map((y) => ({ value: y.id, label: `${y.name}${y.status === 'current' ? ' (current)' : ''}` }))]} />
      )}
      {show.includes('branch') && status.role === 'OWNER' && status.branches.length > 1 && (
        <Select label="Branch" size="sm" value={value.branch ?? ''} onChange={(e) => set('branch', e.target.value)} options={[{ value: '', label: 'All branches' }, ...status.branches.map((b) => ({ value: b.id, label: b.name }))]} />
      )}
      {show.includes('class') && <Select label="Class" size="sm" value={value.class ?? ''} onChange={(e) => set('class', e.target.value)} options={[{ value: '', label: 'All classes' }, ...status.classes.map((c) => ({ value: c.id, label: c.name }))]} />}
      {show.includes('section') && (
        <Select label="Section" size="sm" value={value.section ?? ''} onChange={(e) => set('section', e.target.value)} options={[{ value: '', label: 'All sections' }, ...sections.map((s) => ({ value: s.id, label: `${status.classes.find((c) => c.id === s.classId)?.name ?? ''}${s.name}` }))]} />
      )}
      {show.includes('dates') && (
        <>
          <Input label="From" type="date" size="sm" value={value.from ?? ''} onChange={(e) => set('from', e.target.value)} />
          <Input label="To" type="date" size="sm" value={value.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </>
      )}
      {children}
    </div>
  );
}

/** Prints a PDF through a hidden frame (falls back to opening it). */
export function printBlob(blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.title = 'Print';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  frame.src = url;
  document.body.appendChild(frame);
}

/** A small "label: value" pair list. */
export function Facts({ items, className = '' }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-2 text-small sm:grid-cols-2 ${className}`}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-border-subtle py-1.5">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="text-right font-medium text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

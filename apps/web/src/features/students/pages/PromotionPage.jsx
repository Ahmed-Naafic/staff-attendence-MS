import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Check, RefreshCw } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { cn } from '../../../lib/cn.js';
import { useSession } from '../../auth';
import { confirmPromotion, loadPromotion, processPromotion, refreshPromotion, retryPromotion, updatePromotionItems } from '../data/studentsApi.js';
import { DECISION, groupChange, ITEM_STATUS, needsTarget, targetChoices } from '../utils/studentRules.js';
import { BATCH_STATUS } from './PromotionsPage.jsx';

const PAGE_SIZE = 50;
const DECISIONS = ['PROMOTE', 'REPEAT', 'TRANSFER_OUT', 'GRADUATE', 'PENDING'];
const STEPS = ['Choose years', 'Load students', 'Recommendations', 'Destinations', 'Review', 'Confirm & process'];

function Steps({ current }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Promotion steps">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={label}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-pill border px-3 py-1 text-small',
              state === 'done' && 'border-success/40 bg-success-soft text-success-fg',
              state === 'current' && 'border-accent bg-accent-soft font-medium text-accent-fg',
              state === 'todo' && 'border-border text-fg-muted',
            )}
          >
            {state === 'done' ? <Check aria-hidden="true" className="size-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-md border border-border bg-surface p-3', tone === 'warn' && value > 0 && 'border-warning/50 bg-warning-soft')}>
      <span className="text-caption text-fg-muted">{label}</span>
      <span className="text-card-title tabular-nums text-fg">{value}</span>
    </div>
  );
}

/**
 * One promotion (Bulk Academic Year Enrollment & Promotion). Draft (Manager): review recommendations
 * by previous section, change decisions one by one or per section, choose destinations (missing ones
 * are flagged, never filled with another section), see capacity, and confirm by typing PROCESS.
 * Processing: runs in chunks with progress until done; failed students are listed and can be retried.
 * Owners see everything read only.
 */
export default function PromotionPage() {
  const { batchId } = useParams();
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const manager = role === 'MANAGER';
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ group: '', decision: '', flagged: false, q: '' });
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const processing = useRef(false);

  useEffect(() => {
    let active = true;
    loadPromotion(role, batchId).then(
      (result) => active && setData(result),
      (failed) => active && setLoadError(failed),
    );
    return () => {
      active = false;
    };
  }, [role, batchId]);

  const act = async (work, fallback) => {
    setError('');
    setBusy(true);
    try {
      setData(await work());
    } catch (failed) {
      setError(failed.status === 0 || failed.status === 409 || failed.status === 400 || failed.status === 404 ? failed.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  // Processing runs call after call (each call works for a limited time) until nothing is waiting.
  const status = data?.batch.status;
  useEffect(() => {
    if (!manager || status !== 'processing' || processing.current) return undefined;
    let active = true;
    processing.current = true;
    (async () => {
      try {
        let result = data;
        while (active && result.batch.status === 'processing') {
          result = await processPromotion(batchId);
          if (active) setData(result);
        }
      } catch (failed) {
        if (active) setError(failed.status === 0 ? failed.message : 'Processing stopped. The students already processed are kept; continue to process the rest.');
      } finally {
        processing.current = false;
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, status, batchId]);

  const items = data?.items ?? [];
  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter(
      (row) =>
        (!filters.group || row.from.sectionId === filters.group) &&
        (!filters.decision || row.decision === filters.decision) &&
        (!filters.flagged || row.missingTarget || row.status === 'failed') &&
        (!q || row.student.fullName.toLowerCase().includes(q) || row.student.studentNumber.toLowerCase().includes(q)),
    );
  }, [items, filters]);
  useEffect(() => setPage(1), [filters]);

  if (loadError) {
    return (
      <PageContainer>
        <PageHeader title="Promotion" breadcrumbs={[{ label: 'Promotions', to: '/promotions' }, { label: 'Promotion' }]} />
        <Card>
          <ErrorState title={loadError.status === 404 ? 'Promotion not found' : 'The promotion could not be loaded'} description={loadError.status === 404 ? 'It does not exist or is not part of your scope.' : 'Check your connection and try again.'} />
        </Card>
      </PageContainer>
    );
  }
  if (!data) {
    return (
      <PageContainer>
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </PageContainer>
    );
  }

  const { batch, summary, groups, targets } = data;
  const draft = batch.status === 'draft';
  const editable = manager && draft;
  const step = draft ? (summary.missingTargets || summary.decisions.PENDING ? 3 : 4) : 5;
  const processed = summary.status.done + summary.status.failed;
  const toProcess = summary.total - summary.status.excluded;
  const change = (changes) => act(() => updatePromotionItems(batch.id, changes), 'The decisions could not be saved. Try again.');
  const shown = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <PageContainer>
      <PageHeader
        title={`Promotion ${batch.fromYear.name} → ${batch.toYear.name}`}
        breadcrumbs={[{ label: 'Promotions', to: '/promotions' }, { label: `${batch.fromYear.name} → ${batch.toYear.name}` }]}
        description={`${batch.branch.name} (${batch.branch.code}) · prepared by ${batch.createdByName}${batch.confirmedByName ? ` · confirmed by ${batch.confirmedByName}` : ''}`}
        secondaryActions={
          editable && (
            <Button variant="outline" leftIcon={RefreshCw} loading={busy} onClick={() => act(() => refreshPromotion(batch.id), 'The students could not be reloaded. Try again.')}>
              Reload Students
            </Button>
          )
        }
        primaryAction={
          editable && (
            <Button
              onClick={() => {
                setTyped('');
                setConfirming(true);
              }}
              unavailableReason={summary.missingTargets ? `${summary.missingTargets} student(s) have no destination section.` : summary.total === 0 ? 'There are no students to process.' : undefined}
            >
              Review & Confirm
            </Button>
          )
        }
      />
      <Steps current={step} />
      <Badge variant={BATCH_STATUS[batch.status].variant}>{BATCH_STATUS[batch.status].label}</Badge>
      {error && (
        <Alert variant="error" onDismiss={() => setError('')}>
          {error}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Students" value={summary.total} />
        <Stat label="Promote" value={summary.decisions.PROMOTE} />
        <Stat label="Repeat" value={summary.decisions.REPEAT} />
        <Stat label="Graduate" value={summary.decisions.GRADUATE} />
        <Stat label="Transfer out" value={summary.decisions.TRANSFER_OUT} />
        <Stat label="Pending review" value={summary.decisions.PENDING} tone="warn" />
        <Stat label="No destination" value={summary.missingTargets} tone="warn" />
        <Stat label="Over capacity" value={summary.overCapacity} tone="warn" />
      </div>

      {!draft && (
        <Card as="section" aria-labelledby="progress" className="flex flex-col gap-3 p-5">
          <h2 id="progress" className="text-card-title text-fg">
            {batch.status === 'completed' ? 'Results' : 'Processing'}
          </h2>
          <div role="progressbar" aria-label="Students processed" aria-valuemin={0} aria-valuemax={toProcess} aria-valuenow={processed} className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${toProcess ? Math.round((processed / toProcess) * 100) : 100}%` }} />
          </div>
          <p className="text-body text-fg-secondary">
            {summary.status.done} done · {summary.status.failed} failed · {summary.status.waiting} waiting · {summary.status.excluded} excluded for review
          </p>
          {summary.status.failed > 0 && batch.status === 'completed' && (
            <Alert variant="warning" title={`${summary.status.failed} student(s) were not processed`}>
              Their errors are listed below (filter “Needs attention”). Fix the cause, then retry: students already processed are never processed twice.
              {manager && (
                <div className="mt-3">
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => act(() => retryPromotion(batch.id), 'Retry could not start. Try again.')}>
                    Retry Failed Students
                  </Button>
                </div>
              )}
            </Alert>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <h2 className="px-6 pt-5 text-card-title text-fg">By previous section</h2>
        <div className="overflow-x-auto">
          <Table caption="Students by previous section and decision">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Previous section</TableHeaderCell>
                <TableHeaderCell>Students</TableHeaderCell>
                <TableHeaderCell>Decisions</TableHeaderCell>
                {editable && <TableHeaderCell align="right">Set the whole section to</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.length === 0 && <TableEmpty columns={editable ? 4 : 3} title="No students" description={`No students of this branch are enrolled in ${batch.fromYear.name}.`} />}
              {groups.map((g) => (
                <TableRow key={g.sectionId}>
                  <TableCell className="font-medium whitespace-nowrap">{g.displayName}</TableCell>
                  <TableCell className="tabular-nums">{g.students}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(g.decisions).map(([d, count]) => (
                        <Badge key={d} variant={DECISION[d].variant}>{`${DECISION[d].label}: ${count}`}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  {editable && (
                    <TableCell align="right">
                      <Select
                        label={`Set every student of ${g.displayName} to`}
                        hideLabel
                        size="sm"
                        options={[{ value: '', label: 'Choose…' }, ...DECISIONS.map((d) => ({ value: d, label: DECISION[d].label }))]}
                        value=""
                        disabled={busy}
                        onChange={(event) => event.target.value && change(groupChange(items.filter((r) => r.from.sectionId === g.sectionId), event.target.value))}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-6 pt-5">
          <h2 className="text-card-title text-fg">Students</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input type="search" label="Search" placeholder="Name or Student ID…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
            <Select label="Previous section" options={[{ value: '', label: 'All sections' }, ...groups.map((g) => ({ value: g.sectionId, label: g.displayName }))]} value={filters.group} onChange={(e) => setFilters((f) => ({ ...f, group: e.target.value }))} />
            <Select label="Decision" options={[{ value: '', label: 'All decisions' }, ...DECISIONS.map((d) => ({ value: d, label: DECISION[d].label }))]} value={filters.decision} onChange={(e) => setFilters((f) => ({ ...f, decision: e.target.value }))} />
            <Select
              label="Show"
              options={[
                { value: '', label: 'Everyone' },
                { value: 'flagged', label: 'Needs attention' },
              ]}
              value={filters.flagged ? 'flagged' : ''}
              onChange={(e) => setFilters((f) => ({ ...f, flagged: e.target.value === 'flagged' }))}
            />
          </div>
        </div>
        <div role="region" aria-label="Student decisions" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
          <Table caption="Each student’s recommendation, decision and destination">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Student</TableHeaderCell>
                <TableHeaderCell>From</TableHeaderCell>
                <TableHeaderCell>Recommendation</TableHeaderCell>
                <TableHeaderCell>Decision</TableHeaderCell>
                <TableHeaderCell>Destination</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.length === 0 && <TableEmpty columns={6} title="No students" description="No students match these filters." />}
              {shown.map((row) => {
                const choices = targetChoices(targets, row, row.decision);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium">{row.student.fullName}</span>
                        <span className="text-small text-fg-muted tabular-nums">{row.student.studentNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.from.displayName}
                      <span className="block text-small text-fg-muted">{row.from.result === 'passed' ? 'Passed' : row.from.result === 'failed' ? 'Failed' : 'No result'}</span>
                    </TableCell>
                    <TableCell className="min-w-[12rem] text-small text-fg-secondary">
                      <Badge variant={DECISION[row.recommendation].variant}>{DECISION[row.recommendation].label}</Badge>
                      <span className="mt-1 block">{row.recommendationNote}</span>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <Select
                          label={`Decision for ${row.student.fullName}`}
                          hideLabel
                          size="sm"
                          options={DECISIONS.map((d) => ({ value: d, label: DECISION[d].label }))}
                          value={row.decision}
                          disabled={busy}
                          onChange={(e) => change(groupChange([row], e.target.value))}
                        />
                      ) : (
                        <Badge variant={DECISION[row.decision].variant}>{DECISION[row.decision].label}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {needsTarget(row.decision) ? (
                        editable ? (
                          <Select
                            label={`Destination for ${row.student.fullName}`}
                            hideLabel
                            size="sm"
                            options={[{ value: '', label: 'No destination — choose' }, ...choices.map((t) => ({ value: t.id, label: t.displayName }))]}
                            value={row.target?.id ?? ''}
                            error={row.missingTarget ? 'Choose a section, or create it and reload.' : undefined}
                            disabled={busy}
                            onChange={(e) => change([{ id: row.id, decision: row.decision, targetSectionId: e.target.value || null }])}
                          />
                        ) : (
                          (row.result ?? row.target?.displayName ?? <span className="text-error-fg">None</span>)
                        )
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ITEM_STATUS[row.status].variant}>{ITEM_STATUS[row.status].label}</Badge>
                      {row.error && <span className="mt-1 block max-w-[16rem] text-small text-error-fg">{row.error}</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {visible.length > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={visible.length} onPageChange={setPage} itemLabel="students" />}
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-6 pt-5 text-card-title text-fg">Destination sections in {batch.toYear.name}</h2>
        <div className="overflow-x-auto">
          <Table caption="Destination sections with students already enrolled, incoming and capacity">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Section</TableHeaderCell>
                <TableHeaderCell>Already enrolled</TableHeaderCell>
                <TableHeaderCell>Incoming</TableHeaderCell>
                <TableHeaderCell>Capacity</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {targets.length === 0 && <TableEmpty columns={4} title={`No sections in ${batch.toYear.name}`} description="Create the new year’s sections under Classes, then reload the students." />}
              {targets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium whitespace-nowrap">{t.displayName}</TableCell>
                  <TableCell className="tabular-nums">{t.enrolled}</TableCell>
                  <TableCell className="tabular-nums">{t.incoming}</TableCell>
                  <TableCell className={cn('tabular-nums', t.overCapacity && 'font-medium text-error-fg')}>
                    {t.capacity ?? '—'}
                    {t.overCapacity && ' · over capacity'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        size="lg"
        title="Confirm Promotion"
        description={`${batch.branch.name} · ${batch.fromYear.name} → ${batch.toYear.name}`}
        loading={busy}
        loadingLabel="Confirming…"
        error={error}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={typed !== 'PROCESS'}
              loading={busy}
              onClick={async () => {
                await act(() => confirmPromotion(batch.id), 'The promotion could not be confirmed. Try again.');
                setConfirming(false);
              }}
            >
              Confirm and Process
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-body text-fg-secondary">
          <p>This is exactly what will happen:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{summary.decisions.PROMOTE} promoted and {summary.decisions.REPEAT} repeating: enrolled in their destination section for {batch.toYear.name}.</li>
            <li>{summary.decisions.GRADUATE} graduated and {summary.decisions.TRANSFER_OUT} transferred out: their {batch.fromYear.name} enrollment ends; they are not enrolled again.</li>
            <li>{summary.decisions.PENDING} pending review: excluded — nothing happens to them; enroll them later from their profile.</li>
            {summary.overCapacity > 0 && <li className="text-error-fg">{summary.overCapacity} destination section(s) will be over capacity.</li>}
          </ul>
          <p>Every {batch.fromYear.name} enrollment is kept. After confirmation the decisions cannot be changed.</p>
          <Input label="Type PROCESS to confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </div>
      </Modal>
    </PageContainer>
  );
}

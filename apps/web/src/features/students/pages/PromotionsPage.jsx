import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRightLeft } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  LinkButton,
  Select,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableError,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatDateTime } from '../../../lib/format.js';
import { loadAcademicYears } from '../../academic-years';
import { useSession } from '../../auth';
import { loadPromotions, startPromotion } from '../data/studentsApi.js';

export const BATCH_STATUS = {
  draft: { label: 'Draft — not confirmed', variant: 'warning' },
  processing: { label: 'Processing', variant: 'info' },
  completed: { label: 'Completed', variant: 'success' },
};

/**
 * Bulk Academic Year Enrollment & Promotion. Manager: step 1 (choose the previous and new academic
 * year; the branch is theirs), then the guided review on the promotion's own page. Owner: every
 * branch's promotions, read only.
 */
export default function PromotionsPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const manager = role === 'MANAGER';
  const navigate = useNavigate();
  const list = useApiData(() => loadPromotions(role), `promotions|${role}`);
  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const yearList = years.data?.items ?? [];
  const [fromYearId, setFrom] = useState('');
  const [toYearId, setTo] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const from = fromYearId || yearList.find((y) => y.status === 'current')?.id || '';
  const fromYear = yearList.find((y) => y.id === from);
  const laterYears = yearList.filter((y) => fromYear && y.startDate > fromYear.startDate && y.status !== 'closed');
  const to = toYearId && laterYears.some((y) => y.id === toYearId) ? toYearId : (laterYears.at(-1)?.id ?? '');

  async function start() {
    setError('');
    if (!from || !to) return setError('Choose the previous academic year and a later planned or current year.');
    setStarting(true);
    try {
      const result = await startPromotion(from, to);
      navigate(`/promotions/${result.batch.id}`);
    } catch (failed) {
      setError(failed.status === 0 || failed.status === 409 || failed.status === 400 ? failed.message : 'The promotion could not be prepared. Try again.');
      setStarting(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Academic Year Promotion"
        description={
          manager
            ? 'Prepare your branch’s students for a new academic year: review every recommendation, choose destinations, then confirm. Nothing happens until you confirm.'
            : 'Promotions prepared by your branches’ Managers (read only).'
        }
      />

      {manager && (
        <Card as="section" aria-labelledby="new-promotion" className="flex flex-col gap-4 p-5">
          <h2 id="new-promotion" className="text-card-title text-fg">
            Step 1 · Choose the academic years
          </h2>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Previous academic year" options={[{ value: '', label: 'Choose' }, ...yearList.map((y) => ({ value: y.id, label: `${y.name} (${y.status})` }))]} value={from} onChange={(e) => setFrom(e.target.value)} />
            <Select
              label="New academic year"
              options={laterYears.length ? laterYears.map((y) => ({ value: y.id, label: `${y.name} (${y.status})` })) : [{ value: '', label: 'Plan the new year first' }]}
              value={to}
              hint="A later planned or current year."
              onChange={(e) => setTo(e.target.value)}
            />
            <Button className="self-end" leftIcon={ArrowRightLeft} loading={starting} onClick={start} disabled={!from || !to}>
              Load Students
            </Button>
          </div>
          <p className="text-small text-fg-muted">Your branch’s students enrolled in the previous year are loaded with recommendations. If a promotion for these years already exists, it is reopened.</p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div role="region" aria-label="Promotions" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
          <Table caption="Promotions, newest first">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>From → To</TableHeaderCell>
                {!manager && <TableHeaderCell>Branch</TableHeaderCell>}
                <TableHeaderCell>Students</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Confirmed</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.status === 'error' && <TableError columns={6} title="Promotions could not be loaded" onRetry={list.retry} />}
              {!list.data && list.status !== 'error' && <TableLoading columns={6} rows={3} />}
              {list.data?.items.length === 0 && <TableEmpty columns={6} icon={ArrowRightLeft} title="No promotions yet" description={manager ? 'Choose the academic years above to start one.' : 'Managers prepare promotions for their branches.'} />}
              {list.data?.items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium whitespace-nowrap">{`${b.fromYear.name} → ${b.toYear.name}`}</TableCell>
                  {!manager && <TableCell className="whitespace-nowrap text-fg-secondary">{`${b.branch.name} (${b.branch.code})`}</TableCell>}
                  <TableCell className="tabular-nums">{b.students}</TableCell>
                  <TableCell>
                    <Badge variant={BATCH_STATUS[b.status].variant}>{BATCH_STATUS[b.status].label}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{b.confirmedAt ? `${formatDateTime(b.confirmedAt)} · ${b.confirmedByName}` : '—'}</TableCell>
                  <TableCell align="right">
                    <TableActions>
                      <LinkButton to={`/promotions/${b.id}`} size="sm" variant="outline">
                        {manager && b.status !== 'completed' ? 'Continue' : 'View'}
                      </LinkButton>
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </PageContainer>
  );
}

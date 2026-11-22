import { useState } from 'react';
import { CalendarRange, Plus, Tags } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, ConfirmModal, ErrorState, Select, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadAcademicYears } from '../../academic-years';
import { StatusBadge } from '../../classes/components/ClassModals.jsx';
import { ExamPage, useExamRole } from '../components/ExamGate.jsx';
import { ExamTypeModal, PeriodModal } from '../components/ExamModals.jsx';
import { loadExamSettings, loadExamTypes, loadPeriods, loadScales, setExamTypeActive, setPeriodActive } from '../data/examApi.js';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

/** Examinations → Types & Periods: the academic periods of a year and the examination types (School Owner manages; Managers read). */
export default function ExamSetupPage() {
  const role = useExamRole();
  const owner = role === 'OWNER';
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const [yearId, setYearId] = useState('');
  const [periodStatus, setPeriodStatus] = useState('active');
  const [typeStatus, setTypeStatus] = useState('active');
  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const year = yearId || years.data?.current?.id || years.data?.items?.[0]?.id || '';
  const periods = useApiData(() => (year ? loadPeriods(role, { academicYear: year, status: periodStatus }) : Promise.resolve({ items: [], academicYear: null })), `periods|${year}|${periodStatus}|${version}`);
  const types = useApiData(() => loadExamTypes(role, { status: typeStatus }), `types|${typeStatus}|${version}`);
  const scales = useApiData(() => loadScales(role, { status: 'all' }), `scales|${version}`);
  const settings = useApiData(() => loadExamSettings(role), `settings|${role}`);
  const done = (message) => (item) => {
    setDialog(null);
    setNotice(message(item));
    setVersion((n) => n + 1);
  };
  const selectedYear = years.data?.items?.find((y) => y.id === year);
  const closed = selectedYear?.status === 'closed';
  const periodItems = periods.data?.items ?? [];
  const typeItems = types.data?.items ?? [];

  return (
    <ExamPage
      title="Types & Periods"
      description={owner ? 'The terms or semesters of each academic year, and the kinds of examinations your school holds.' : 'Your school’s academic periods and examination types. They are managed by your School Owner.'}
    >
      {() => (
        <>
          {notice && (
            <Alert variant="success" onDismiss={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          <Card as="section" aria-labelledby="periods-title" className="overflow-hidden">
            <CardHeader
              title={<span id="periods-title">Academic periods</span>}
              description="Terms or semesters. Examinations and report cards belong to a period. Periods of a year never overlap."
              action={
                owner && selectedYear && (
                  <Button size="sm" leftIcon={Plus} onClick={() => setDialog({ type: 'period' })} unavailableReason={closed ? `${selectedYear.name} is closed.` : undefined}>
                    Add Period
                  </Button>
                )
              }
            />
            <div className="grid grid-cols-1 gap-3 px-5 pt-4 sm:grid-cols-2 lg:w-2/3">
              <Select
                label="Academic year"
                options={(years.data?.items ?? []).map((y) => ({ value: y.id, label: `${y.name}${y.status === 'current' ? ' (current)' : y.status === 'closed' ? ' (closed)' : ''}` }))}
                value={year}
                onChange={(e) => setYearId(e.target.value)}
                disabled={!years.data?.items?.length}
              />
              <Select label="Status" options={STATUS_OPTIONS} value={periodStatus} onChange={(e) => setPeriodStatus(e.target.value)} />
            </div>
            {periods.status === 'error' && !periods.data ? (
              <ErrorState title="Periods could not be loaded" description="Check your connection and try again." onRetry={periods.retry} />
            ) : (
              <div role="region" aria-label="Academic periods" tabIndex={0} className="mt-4 overflow-x-auto">
                <Table caption="Academic periods of the year, in order">
                  <TableHead>
                    <TableRow interactive={false}>
                      <TableHeaderCell>#</TableHeaderCell>
                      <TableHeaderCell>Period</TableHeaderCell>
                      <TableHeaderCell>Starts</TableHeaderCell>
                      <TableHeaderCell>Ends</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell align="right">{owner ? 'Actions' : ''}</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {!periods.data && <TableLoading columns={6} />}
                    {periods.data && !periodItems.length && (
                      <TableEmpty
                        columns={6}
                        icon={CalendarRange}
                        title={years.data && !years.data.items.length ? 'No academic years yet' : 'No periods'}
                        description={years.data && !years.data.items.length ? 'Add an academic year under School Schedule first.' : owner ? 'Add the terms or semesters of this year, e.g. Term 1 and Term 2.' : 'Your School Owner has not added periods for this year.'}
                      />
                    )}
                    {periodItems.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="tabular-nums text-fg-secondary">{p.sequence || '—'}</TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="tabular-nums">{p.startDate}</TableCell>
                        <TableCell className="tabular-nums">{p.endDate}</TableCell>
                        <TableCell><StatusBadge status={p.status} /></TableCell>
                        <TableCell align="right">
                          {owner && !closed && (
                            <TableActions>
                              <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'period', period: p })}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'period-status', period: p })}>{p.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>
                            </TableActions>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          <Card as="section" aria-labelledby="types-title" className="overflow-hidden">
            <CardHeader
              title={<span id="types-title">Examination types</span>}
              description="Mid-Term, Final, Monthly Test… Only types that stop normal lessons stop the timetable on examination days."
              action={owner && <Button size="sm" leftIcon={Plus} onClick={() => setDialog({ type: 'type' })}>Add Type</Button>}
            />
            <div className="grid grid-cols-1 gap-3 px-5 pt-4 sm:w-1/3">
              <Select label="Status" options={STATUS_OPTIONS} value={typeStatus} onChange={(e) => setTypeStatus(e.target.value)} />
            </div>
            {types.status === 'error' && !types.data ? (
              <ErrorState title="Examination types could not be loaded" description="Check your connection and try again." onRetry={types.retry} />
            ) : (
              <div role="region" aria-label="Examination types" tabIndex={0} className="mt-4 overflow-x-auto">
                <Table caption="Examination types by name">
                  <TableHead>
                    <TableRow interactive={false}>
                      <TableHeaderCell>Type</TableHeaderCell>
                      <TableHeaderCell>Marks out of</TableHeaderCell>
                      <TableHeaderCell>Lessons</TableHeaderCell>
                      <TableHeaderCell>Grading scale</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell align="right">{owner ? 'Actions' : ''}</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {!types.data && <TableLoading columns={6} />}
                    {types.data && !typeItems.length && (
                      <TableEmpty columns={6} icon={Tags} title="No examination types" description={owner ? 'Add the kinds of examinations your school holds, e.g. Mid-Term and Final.' : 'Your School Owner has not added examination types yet.'} />
                    )}
                    {typeItems.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">
                          <span className="flex flex-col">
                            {t.name}
                            {t.description && <span className="text-caption font-normal text-fg-muted">{t.description}</span>}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{t.defaultMaxMarks}</TableCell>
                        <TableCell>{t.stopsLessons ? <Badge variant="warning">Stop</Badge> : <Badge variant="neutral">Continue</Badge>}</TableCell>
                        <TableCell className="text-fg-secondary">{t.gradingScale?.name ?? 'School default'}</TableCell>
                        <TableCell><StatusBadge status={t.status} /></TableCell>
                        <TableCell align="right">
                          {owner && (
                            <TableActions>
                              <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'type', examType: t })}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'type-status', examType: t })}>{t.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>
                            </TableActions>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          {owner && (
            <>
              <PeriodModal role={role} year={selectedYear} period={dialog?.period} open={dialog?.type === 'period'} onClose={() => setDialog(null)} onSaved={done((p) => `${p.name} was saved.`)} />
              <ExamTypeModal
                role={role}
                type={dialog?.examType}
                scales={scales.data?.items ?? []}
                maxMarksLimit={settings.data?.school?.effective?.maxMarksLimit ?? 1000}
                open={dialog?.type === 'type'}
                onClose={() => setDialog(null)}
                onSaved={done((t) => `${t.name} was saved.`)}
              />
              <ConfirmModal
                open={dialog?.type === 'period-status'}
                onClose={() => setDialog(null)}
                title={`${dialog?.period?.status === 'active' ? 'Deactivate' : 'Reactivate'} ${dialog?.period?.name ?? ''}?`}
                description={dialog?.period?.status === 'active' ? 'It is no longer offered for new examinations. Nothing recorded is deleted.' : 'It is offered for examinations again (its dates must not overlap another active period).'}
                confirmLabel={dialog?.period?.status === 'active' ? 'Deactivate' : 'Reactivate'}
                variant={dialog?.period?.status === 'active' ? 'danger' : 'secondary'}
                run={() => setPeriodActive(role, dialog.period.id, dialog.period.status !== 'active')}
                onDone={done((p) => `${p.name} is now ${p.status}.`)}
              />
              <ConfirmModal
                open={dialog?.type === 'type-status'}
                onClose={() => setDialog(null)}
                title={`${dialog?.examType?.status === 'active' ? 'Deactivate' : 'Reactivate'} ${dialog?.examType?.name ?? ''}?`}
                description={dialog?.examType?.status === 'active' ? 'It is no longer offered for new examinations. Examinations already held keep it.' : 'It is offered for new examinations again.'}
                confirmLabel={dialog?.examType?.status === 'active' ? 'Deactivate' : 'Reactivate'}
                variant={dialog?.examType?.status === 'active' ? 'danger' : 'secondary'}
                run={() => setExamTypeActive(role, dialog.examType.id, dialog.examType.status !== 'active')}
                onDone={done((t) => `${t.name} is now ${t.status}.`)}
              />
            </>
          )}
        </>
      )}
    </ExamPage>
  );
}

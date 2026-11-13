import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Button,
  Card,
  ConfirmModal,
  ErrorState,
  Input,
  Select,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadOwnerSchoolStatus } from '../../academic-years';
import { useSession } from '../../auth';
import { StatusBadge } from '../../classes/components/ClassModals.jsx';
import { SubjectModal } from '../components/TeachingModals.jsx';
import { loadSubjects, setSubjectActive } from '../data/teachingApi.js';

const COLUMNS = 6;

/**
 * Subjects of the school. School Owner: adds, edits, deactivates and reactivates them (each class's
 * subjects are set on its class page). Manager: reads them. Used every academic year in every branch.
 */
export default function SubjectsPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useApiData(() => loadSubjects(role, filters), JSON.stringify([role, filters, version]), { delayMs: 200 });
  const school = useApiData(() => (owner ? loadOwnerSchoolStatus() : Promise.resolve(null)), `school|${version}`);
  const readOnly = school.data === 'suspended';
  const unavailable = readOnly ? 'Your school is suspended: subjects cannot be changed until it is reactivated.' : undefined;
  const done = (message) => (subject) => {
    setDialog(null);
    setNotice(message(subject));
    setVersion((n) => n + 1);
  };
  const items = list.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Subjects"
        description={owner ? 'Your school’s subjects, used every academic year in every branch. Choose each class’s subjects on its class page.' : 'Your school’s subjects. They are managed by your School Owner.'}
        primaryAction={
          owner && (
            <Button leftIcon={Plus} onClick={() => setDialog({ type: 'form' })} unavailableReason={unavailable}>
              Add Subject
            </Button>
          )
        }
      />
      {readOnly && <Alert variant="warning" title="Your school is suspended">You can view subjects but not change them until the school is reactivated.</Alert>}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <Card as="section" aria-label="Subject filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input type="search" label="Search subjects" placeholder="Name or code…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          <Select
            label="Status"
            options={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          />
        </div>
      </Card>
      <Card className="overflow-hidden">
        {list.status === 'error' && !list.data ? (
          <ErrorState title="Subjects could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
        ) : (
          <div role="region" aria-label="Subjects" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
            <Table caption="Subjects of your school by name">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Subject</TableHeaderCell>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Classes</TableHeaderCell>
                  <TableHeaderCell>Teaching now</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">{owner ? 'Actions' : ''}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!list.data && <TableLoading columns={COLUMNS} />}
                {list.data && items.length === 0 && (
                  <TableEmpty
                    columns={COLUMNS}
                    icon={BookOpen}
                    title={filters.q || filters.status ? 'No subjects found' : 'No subjects yet'}
                    description={owner ? 'Add the subjects your school teaches, e.g. Mathematics, English, Science.' : 'Your School Owner has not added subjects yet.'}
                  />
                )}
                {items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <span className="flex flex-col">
                        {s.name}
                        {s.description && <span className="text-caption font-normal text-fg-muted">{s.description}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-fg-secondary">{s.code || '—'}</TableCell>
                    <TableCell className="tabular-nums">{s.classes}</TableCell>
                    <TableCell className="tabular-nums">{s.assignments}</TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell align="right">
                      {owner && (
                        <TableActions>
                          <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'form', subject: s })} unavailableReason={unavailable}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'status', subject: s })} unavailableReason={unavailable}>
                            {s.status === 'active' ? 'Deactivate' : 'Reactivate'}
                          </Button>
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
          <SubjectModal subject={dialog?.subject} open={dialog?.type === 'form'} onClose={() => setDialog(null)} onSaved={done((s) => `${s.name} was saved.`)} />
          <ConfirmModal
            open={dialog?.type === 'status'}
            onClose={() => setDialog(null)}
            title={dialog?.subject?.status === 'active' ? `Deactivate ${dialog?.subject?.name}?` : `Reactivate ${dialog?.subject?.name}?`}
            description={
              dialog?.subject?.status === 'active'
                ? 'It can no longer be given to teachers or added to classes. Not possible while it is still taught.'
                : 'It can be given to teachers and added to classes again.'
            }
            confirmLabel={dialog?.subject?.status === 'active' ? 'Deactivate' : 'Reactivate'}
            variant={dialog?.subject?.status === 'active' ? 'danger' : 'secondary'}
            run={() => setSubjectActive(dialog.subject.id, dialog.subject.status !== 'active')}
            onDone={done((s) => `${s.name} is now ${s.status}.`)}
          />
        </>
      )}
    </PageContainer>
  );
}

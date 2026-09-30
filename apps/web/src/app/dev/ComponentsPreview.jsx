import { useId, useState } from 'react';
import { Download, Eye, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { ContentSection, PageContainer, PageHeader } from '../../components/layout';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Checkbox,
  Drawer,
  DropdownMenu,
  Input,
  Modal,
  Pagination,
  RadioGroup,
  Select,
  Switch,
  TabPanel,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableError,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
  Tabs,
  Textarea,
  Tooltip,
} from '../../components/ui';

// Neutral sample rows for previewing table states.
const rows = [
  { id: 1, name: 'Sample record one', category: 'Category A', status: ['success', 'Active'], updated: 'Jan 12, 2026' },
  { id: 2, name: 'Sample record two', category: 'Category B', status: ['warning', 'Pending'], updated: 'Jan 10, 2026' },
  { id: 3, name: 'Sample record three', category: 'Category A', status: ['error', 'Suspended'], updated: 'Jan 08, 2026' },
  { id: 4, name: 'Sample record four', category: 'Category C', status: ['info', 'In review'], updated: 'Jan 05, 2026' },
];

const selectOptions = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C (disabled)', disabled: true },
];

function Demo({ title, children, className }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardContent className={className}>{children}</CardContent>
    </Card>
  );
}

export default function ComponentsPreview() {
  const [modal, setModal] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState(1);
  const [tableState, setTableState] = useState('data');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('overview');
  const [radio, setRadio] = useState('a');
  const [menuChoice, setMenuChoice] = useState('name');
  const tabsId = useId();

  return (
    <PageContainer>
      <PageHeader
        title="Components"
        description="Reusable UI components and their states."
        breadcrumbs={[{ label: 'Design system', to: '/design-system' }, { label: 'Components' }]}
        secondaryActions={
          <Button variant="outline" leftIcon={Download}>
            Secondary action
          </Button>
        }
        primaryAction={<Button leftIcon={Plus}>Primary action</Button>}
      />

      <ContentSection title="Buttons">
        <Demo title="Variants, sizes and states" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" leftIcon={Trash2}>
              Danger
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button variant="outline" iconOnly aria-label="Settings">
              <Settings aria-hidden="true" className="size-[1.125rem]" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Disabled</Button>
            <Button variant="outline" disabled>
              Disabled outline
            </Button>
            <Button loading>Saving…</Button>
            <Button variant="secondary" loading>
              Loading
            </Button>
          </div>
        </Demo>
      </ContentSection>

      <ContentSection title="Form controls">
        <div className="grid gap-6 lg:grid-cols-2">
          <Demo title="Inputs" className="grid gap-4 sm:grid-cols-2">
            <Input label="Text" placeholder="Enter text" hint="Helper text under the field." />
            <Input label="Required" required placeholder="Required field" />
            <Input label="Password" type="password" defaultValue="secret-value" />
            <Input label="Search" type="search" placeholder="Search…" />
            <Input label="Number" type="number" defaultValue={42} />
            <Input label="Date" type="date" />
            <Input label="Time" type="time" />
            <Input label="With error" defaultValue="invalid value" error="This value is not valid." />
            <Input label="Disabled" disabled defaultValue="Disabled value" />
            <Input label="Read-only" readOnly defaultValue="Read-only value" />
            <Textarea label="Textarea" placeholder="Longer text" fieldClassName="sm:col-span-2" />
          </Demo>

          <div className="flex flex-col gap-6">
            <Demo title="Select" className="grid gap-4 sm:grid-cols-2">
              <Select label="Default" placeholder="Choose an option" options={selectOptions} defaultValue="" />
              <Select label="Selected" options={selectOptions} defaultValue="b" />
              <Select label="Disabled" options={selectOptions} disabled defaultValue="a" />
              <Select label="With error" options={selectOptions} error="Choose an option." defaultValue="a" />
            </Demo>

            <Demo title="Checkbox, radio and switch" className="grid gap-6 sm:grid-cols-3">
              <div className="flex flex-col gap-3">
                <Checkbox label="Unchecked" />
                <Checkbox label="Checked" defaultChecked />
                <Checkbox label="Indeterminate" indeterminate />
                <Checkbox label="Disabled" disabled defaultChecked />
                <Checkbox label="With error" error="Required." />
              </div>
              <RadioGroup
                legend="Radio"
                value={radio}
                onChange={setRadio}
                options={[
                  { value: 'a', label: 'Selected' },
                  { value: 'b', label: 'Unselected' },
                  { value: 'c', label: 'Disabled', disabled: true },
                ]}
              />
              <div className="flex flex-col gap-3">
                <Switch label="On" defaultChecked />
                <Switch label="Off" />
                <Switch label="Disabled" disabled defaultChecked />
                <Switch label="With description" description="Helper text for the setting." />
              </div>
            </Demo>
          </div>
        </div>
      </ContentSection>

      <ContentSection title="Badges and tooltips">
        <Demo title="Status badges" className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="accent">Accent</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="success" dot>
              With dot
            </Badge>
            <Badge variant="error" dot>
              With dot
            </Badge>
          </div>
          <div className="flex flex-wrap gap-3">
            <Tooltip content="Tooltip on top">
              <Button variant="outline" size="sm">
                Hover or focus me
              </Button>
            </Tooltip>
            <Tooltip content="Tooltip below" placement="bottom">
              <Button variant="outline" size="sm">
                Bottom tooltip
              </Button>
            </Tooltip>
          </div>
        </Demo>
      </ContentSection>

      <ContentSection title="Cards">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader title="Default card" description="Border, no shadow." action={<Badge variant="info">Info</Badge>} />
            <CardContent>
              <p className="text-small text-fg-secondary">Card content uses 20px padding.</p>
            </CardContent>
            <CardFooter>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
              <Button size="sm">Confirm</Button>
            </CardFooter>
          </Card>
          <Card variant="elevated">
            <CardHeader title="Elevated card" description="Medium shadow for emphasis." />
            <CardContent>
              <p className="text-display text-fg">1,240</p>
              <p className="text-small text-fg-muted">Key figure example</p>
            </CardContent>
          </Card>
          <Card variant="interactive" as="button" type="button" onClick={() => setDrawerOpen(true)}>
            <CardHeader title="Interactive card" description="Whole card is a button. Opens the drawer." />
            <CardContent>
              <span className="text-small font-medium text-interactive">Open details →</span>
            </CardContent>
          </Card>
        </div>
      </ContentSection>

      <ContentSection
        title="Table"
        description="Header, hover, selected row, actions, status badges, pagination, and loading / empty / error states."
        actions={
          <Select
            label="Table state"
            hideLabel
            size="sm"
            value={tableState}
            onChange={(event) => setTableState(event.target.value)}
            options={[
              { value: 'data', label: 'With data' },
              { value: 'loading', label: 'Loading' },
              { value: 'empty', label: 'Empty' },
              { value: 'error', label: 'Error' },
            ]}
          />
        }
      >
        <TableContainer label="Sample records">
          <Table caption="Sample records">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>#</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Updated</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tableState === 'loading' && <TableLoading columns={6} rows={4} />}
              {tableState === 'empty' && (
                <TableEmpty
                  columns={6}
                  title="No records yet"
                  description="Records will appear here once they are added."
                  action={<Button size="sm" leftIcon={Plus}>Add record</Button>}
                />
              )}
              {tableState === 'error' && <TableError columns={6} onRetry={() => setTableState('data')} />}
              {tableState === 'data' &&
                rows.map((row) => (
                  <TableRow key={row.id} selected={row.id === selectedRow}>
                    <TableCell className="text-fg-muted">{row.id}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-fg-secondary">{row.category}</TableCell>
                    <TableCell>
                      <Badge variant={row.status[0]}>{row.status[1]}</Badge>
                    </TableCell>
                    <TableCell className="text-fg-secondary">{row.updated}</TableCell>
                    <TableCell align="right">
                      <TableActions>
                        <Button variant="outline" size="sm" onClick={() => setSelectedRow(row.id)}>
                          View
                        </Button>
                        <DropdownMenu
                          label={`More actions for ${row.name}`}
                          items={[
                            { label: 'View', icon: Eye, onSelect: () => setSelectedRow(row.id) },
                            { label: 'Edit', icon: Pencil, onSelect: () => {} },
                            { label: 'Disabled action', disabled: true },
                            { type: 'separator' },
                            { label: 'Delete', icon: Trash2, destructive: true, onSelect: () => {} },
                          ]}
                        />
                      </TableActions>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {tableState === 'data' && (
            <Pagination page={page} pageSize={4} total={28} onPageChange={setPage} itemLabel="records" />
          )}
        </TableContainer>
      </ContentSection>

      <ContentSection title="Tabs, menus and overlays">
        <div className="grid gap-6 lg:grid-cols-2">
          <Demo title="Tabs" className="flex flex-col gap-4">
            <Tabs
              id={tabsId}
              label="Sample tabs"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'overview', label: 'Overview' },
                { value: 'details', label: 'Details' },
                { value: 'history', label: 'History' },
                { value: 'disabled', label: 'Disabled', disabled: true },
              ]}
            />
            <TabPanel tabsId={tabsId} value={tab}>
              <p className="text-small text-fg-secondary">Content for the “{tab}” tab.</p>
            </TabPanel>
          </Demo>

          <Demo title="Dropdown, modal and drawer" className="flex flex-wrap items-start gap-3">
            <DropdownMenu
              label="Sort by"
              align="start"
              renderTrigger={(props) => (
                <Button {...props} variant="outline">
                  Sort by
                </Button>
              )}
              items={[
                { type: 'label', label: 'Sort by' },
                { label: 'Name', selected: menuChoice === 'name', onSelect: () => setMenuChoice('name') },
                { label: 'Date', selected: menuChoice === 'date', onSelect: () => setMenuChoice('date') },
                { label: 'Unavailable', disabled: true },
              ]}
            />
            <Button variant="outline" onClick={() => setModal('default')}>
              Open modal
            </Button>
            <Button variant="outline" onClick={() => setModal('loading')}>
              Modal: loading
            </Button>
            <Button variant="outline" onClick={() => setModal('error')}>
              Modal: error
            </Button>
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
              Open drawer
            </Button>
          </Demo>
        </div>
      </ContentSection>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title="Modal title"
        description="Supporting description for the dialog."
        loading={modal === 'loading'}
        error={modal === 'error' ? 'The changes could not be saved. Try again.' : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(null)} disabled={modal === 'loading'}>
              Cancel
            </Button>
            <Button onClick={() => setModal(null)} loading={modal === 'loading'}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Name" defaultValue="Sample value" />
          <Select label="Type" options={selectOptions} defaultValue="a" />
          {modal === 'loading' && (
            <Button variant="ghost" size="sm" onClick={() => setModal('default')}>
              (Preview only) Stop loading
            </Button>
          )}
        </div>
      </Modal>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Record details"
        description="Side panel for details."
        header={<Badge variant="success">Active</Badge>}
        footer={
          <>
            <Button variant="danger">Danger action</Button>
            <Button variant="outline">Edit</Button>
            <Button>Primary action</Button>
          </>
        }
      >
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-small">
          <dt className="text-fg-muted">Name</dt>
          <dd className="text-fg">Sample record one</dd>
          <dt className="text-fg-muted">Category</dt>
          <dd className="text-fg">Category A</dd>
          <dt className="text-fg-muted">Updated</dt>
          <dd className="text-fg">Jan 12, 2026</dd>
        </dl>
      </Drawer>
    </PageContainer>
  );
}

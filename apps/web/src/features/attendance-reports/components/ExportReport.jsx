import { useId, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Download, Eye, FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { Alert, Badge, Button, Modal, Spinner } from '../../../components/ui';
import { cn } from '../../../lib/cn.js';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { exportQuery, exportRecords, loadExportPreview } from '../data/attendanceApi.js';
import { cellTone, dialogReducer, downloadAvailability, FORMATS, formatById, initialDialog, previewNote } from '../utils/exportDialog.js';
import { exportErrorMessage, runExport, saveFile } from '../utils/exportRules.js';

const ICONS = { pdf: FileType, xlsx: FileSpreadsheet, csv: FileText };
const TONES = {
  present: 'bg-success-soft text-success-fg font-semibold',
  late: 'bg-warning-soft text-warning-fg font-semibold',
  missing: 'text-error-fg',
  pending: 'italic text-fg-secondary',
  muted: 'text-fg-muted',
  plain: '',
};
const CARDS = [
  ['checkIns', 'Check-ins', 'bg-info-soft text-info-fg'],
  ['present', 'Present', 'bg-success-soft text-success-fg'],
  ['late', 'Late', 'bg-warning-soft text-warning-fg'],
  ['checkedOut', 'Checked out', 'bg-accent-soft text-accent-fg'],
  ['missing', 'No check-out (>24h)', 'bg-error-soft text-error-fg'],
];

/**
 * "Export Report": a dialog to choose PDF, Excel or CSV, preview the report (server data for the
 * current filters; no file is created) and download it. The download goes to the server's export
 * endpoint, which checks scope, dates and the 10,000-row limit again. The report filters on the page
 * are never changed by the dialog.
 */
export function ExportReport({ role, view, range, total }) {
  const [dialog, dispatch] = useReducer(dialogReducer, initialDialog);
  // The preview of the current query, kept while the dialog is used (switching formats reuses it).
  const [preview, setPreview] = useState({ key: null, status: 'idle', data: null, error: null });
  const [download, setDownload] = useState({ status: 'idle', message: '' });
  const [downloadOnce] = useState(createSingleFlight);
  const request = useRef(0);
  const key = range.from ? JSON.stringify(exportQuery(role, view, range)) : null;
  const available = downloadAvailability(range.from ? total : null);
  const format = formatById(dialog.format);
  const current = preview.key === key ? preview : { status: 'idle', data: null, error: null };

  const loadPreview = async () => {
    const id = ++request.current;
    setPreview({ key, status: 'loading', data: null, error: null });
    try {
      const data = await loadExportPreview(role, view, range);
      if (id === request.current) setPreview({ key, status: 'success', data, error: null });
    } catch (error) {
      if (id === request.current) setPreview({ key, status: 'error', data: null, error });
    }
  };
  const showPreview = () => {
    dispatch({ type: 'preview' });
    if (current.status !== 'success' && current.status !== 'loading') loadPreview();
  };
  const onDownload = () =>
    downloadOnce(async () => {
      setDownload({ status: 'loading', message: '' });
      setDownload(await runExport({ request: () => exportRecords(role, view, range, dialog.format), save: saveFile }));
    });
  const open = () => {
    setDownload({ status: 'idle', message: '' });
    dispatch({ type: 'open' });
  };
  const close = () => dispatch({ type: 'close' });

  const busy = download.status === 'loading';
  const previewTotal = current.data?.total;
  const blocked = current.data?.overLimit ? downloadAvailability(previewTotal) : available;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <Button variant="outline" leftIcon={Download} onClick={open} disabled={!range.from} className="w-full sm:w-auto">
        Export Report
      </Button>
      <p className="text-small text-fg-muted">{available.reason ?? 'PDF, Excel or CSV of every matching record (all pages), up to 10,000. Preview before downloading.'}</p>

      <Modal
        open={dialog.open}
        onClose={close}
        size={dialog.step === 'preview' ? 'xl' : 'lg'}
        title={dialog.step === 'preview' ? `Preview: ${format.title}` : 'Export Report'}
        description={dialog.step === 'preview' ? 'This is a preview: nothing has been downloaded.' : 'Choose a format, preview the report, then download it. Your report filters stay as they are.'}
        footer={
          <>
            {dialog.step === 'preview' ? (
              <Button variant="ghost" leftIcon={ArrowLeft} onClick={() => dispatch({ type: 'back' })} disabled={busy}>
                Back to formats
              </Button>
            ) : (
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
            )}
            {dialog.step === 'choose' && (
              <Button variant="outline" leftIcon={Eye} onClick={showPreview} disabled={busy}>
                Preview Report
              </Button>
            )}
            <Button variant="primary" leftIcon={Download} onClick={onDownload} loading={busy} unavailableReason={blocked.reason ?? undefined}>
              {busy ? `Preparing ${format.label}…` : `Download ${format.label}`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {dialog.step === 'choose' ? (
            <FormatChoice value={dialog.format} onChange={(id) => dispatch({ type: 'format', format: id })} />
          ) : (
            <>
              <FormatTabs value={dialog.format} onChange={(id) => dispatch({ type: 'format', format: id })} />
              {current.status === 'loading' && (
                <div className="grid min-h-48 place-items-center" aria-busy="true">
                  <Spinner size="lg" label="Loading the preview" className="text-interactive" />
                </div>
              )}
              {current.status === 'error' && (
                <Alert variant="error" title="The preview could not be loaded" action={<Button size="sm" variant="outline" onClick={loadPreview}>Try again</Button>}>
                  {exportErrorMessage(current.error)}
                </Alert>
              )}
              {current.status === 'success' && <Preview format={dialog.format} data={current.data} />}
            </>
          )}
          <p aria-live="polite" className="sr-only">
            {busy ? `Preparing the ${format.label} file.` : download.message}
          </p>
          {download.status === 'success' && <Alert variant="success">{download.message}</Alert>}
          {download.status === 'error' && (
            <Alert variant="error" title="Download failed">
              {download.message}
            </Alert>
          )}
        </div>
      </Modal>
    </div>
  );
}

/** Three format cards (a radio group: arrow keys move between them). */
function FormatChoice({ value, onChange }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-small font-medium text-fg">Format</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FORMATS.map((f) => {
          const Icon = ICONS[f.id];
          const selected = f.id === value;
          return (
            <label
              key={f.id}
              className={cn(
                'flex cursor-pointer flex-col gap-2 rounded-lg border-2 p-4 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-interactive',
                selected ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong',
              )}
            >
              <input type="radio" name={name} value={f.id} checked={selected} onChange={() => onChange(f.id)} className="sr-only" />
              <span className="flex items-center gap-2">
                <Icon aria-hidden="true" className={cn('size-6', selected ? 'text-accent-fg' : 'text-fg-secondary')} />
                <span className="text-card-title text-fg">{f.title}</span>
                <span className="ml-auto text-caption text-fg-muted">{f.extension}</span>
              </span>
              <span className="text-small text-fg-secondary">{f.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Switch the previewed format without leaving the preview. */
function FormatTabs({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Preview format" className="inline-flex self-start rounded-md border border-border p-0.5">
      {FORMATS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={f.id === value}
          onClick={() => onChange(f.id)}
          className={cn('rounded px-3 py-1.5 text-small font-medium', f.id === value ? 'bg-interactive text-on-interactive' : 'text-fg-secondary hover:bg-muted')}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function Preview({ format, data }) {
  return (
    <div className="flex flex-col gap-3">
      {data.overLimit && (
        <Alert variant="warning" title="Too many records to download">
          {`These filters match ${data.total.toLocaleString('en')} records; a report can contain at most ${data.limit.toLocaleString('en')}. Narrow the dates or filters, then download.`}
        </Alert>
      )}
      {format === 'pdf' && <PdfPreview data={data} />}
      {format === 'xlsx' && <WorkbookPreview data={data} />}
      {format === 'csv' && <CsvPreview data={data} />}
      <p className="text-small text-fg-muted">{previewNote(data)}</p>
    </div>
  );
}

function Heading({ head }) {
  return (
    <div className="border-b-4 border-accent bg-primary px-4 py-4 text-sidebar-fg-strong sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-section-title font-bold break-words">{head.title}</p>
          <p className="text-body font-semibold break-words">{head.school}</p>
          <p className="text-small opacity-80">{`Period: ${head.period} | Time zone: ${head.timeZones.join(', ')}`}</p>
        </div>
        <dl className="text-caption opacity-80 sm:text-right">
          <div>{`Generated on: ${head.generatedOn}`}</div>
          <div>{`Generated by: ${head.generatedBy}`}</div>
          <div>{`Report type: ${head.reportType}`}</div>
        </dl>
      </div>
    </div>
  );
}

function Details({ head }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-small">
      <dt className="font-semibold text-fg-secondary">Scope</dt>
      <dd className="break-words">{head.scope}</dd>
      <dt className="font-semibold text-fg-secondary">Filters</dt>
      <dd className="break-words">{head.filters}</dd>
    </dl>
  );
}

function SummaryCards({ summary }) {
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Summary of the records in this report" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {CARDS.map(([key, label, tone]) => (
          <li key={key} className={cn('rounded-md px-3 py-2', tone)}>
            <span className="block text-caption font-semibold">{label}</span>
            <span className="block text-section-title font-bold tabular-nums">{summary[key].toLocaleString('en')}</span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-fg-secondary">{`Also: pending check-out ${summary.pending} · check-out not required ${summary.notRequired} · staff with records ${summary.staff}`}</p>
    </div>
  );
}

function RecordsTable({ data, caption }) {
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[56rem] border-collapse text-left text-caption">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-accent bg-primary text-sidebar-fg-strong">
            {data.columns.map((c) => (
              <th key={c.header} scope="col" className="px-2 py-2 font-semibold">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={data.columns.length} className="px-2 py-4 italic text-fg-muted">
                No attendance records match these filters.
              </td>
            </tr>
          )}
          {data.rows.map((row, i) => (
            <tr key={i} className="border-b border-border-subtle odd:bg-surface even:bg-muted/40">
              {row.map((value, j) => {
                const tone = cellTone(data.columns[j].kind, value);
                return (
                  <td key={j} className={cn('px-2 py-1.5 align-top', ['date', 'time', 'status'].includes(data.columns[j].kind) ? 'whitespace-nowrap' : 'break-words')}>
                    {tone === 'present' || tone === 'late' ? <span className={cn('rounded px-1.5 py-0.5', TONES[tone])}>{value}</span> : <span className={TONES[tone]}>{value}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The PDF's page 1, as a page: heading, scope and filters, summary, absence note, records. */
function PdfPreview({ data }) {
  return (
    <article aria-label="PDF preview" className="overflow-hidden rounded-md border border-border bg-surface shadow-subtle">
      <Heading head={data.head} />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <Details head={data.head} />
        <SummaryCards summary={data.summary} />
        <p className="rounded-md bg-accent-soft px-3 py-2 text-small font-semibold text-accent-fg">{data.notes[0]}</p>
        <h3 className="border-b-2 border-accent pb-1 text-card-title text-fg">Attendance Records</h3>
        <RecordsTable data={data} caption="Attendance records (preview)" />
        <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-fg-secondary">
          {data.notes.slice(1).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** The workbook: an Overview tab and an Attendance Records tab, as in Excel. */
function WorkbookPreview({ data }) {
  const [sheet, setSheet] = useState('records');
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="p-3 sm:p-4">
        {sheet === 'overview' ? (
          <div className="flex flex-col gap-3">
            <Heading head={data.head} />
            <Details head={data.head} />
            <SummaryCards summary={data.summary} />
            <ul className="flex flex-col gap-1 text-caption text-fg-secondary">
              {data.notes.map((note, i) => (
                <li key={note} className={i === 0 ? 'font-semibold text-accent-fg' : undefined}>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="bg-primary px-3 py-2 text-small font-semibold text-sidebar-fg-strong">{`Attendance Records — ${data.head.school} · ${data.head.scope} · ${data.head.period}`}</p>
            <RecordsTable data={data} caption="Attendance Records sheet (preview)" />
          </div>
        )}
      </div>
      <div role="tablist" aria-label="Workbook sheets" className="flex gap-1 border-t border-border bg-muted px-2 pt-1">
        {[
          ['overview', 'Overview'],
          ['records', 'Attendance Records'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={sheet === id}
            onClick={() => setSheet(id)}
            className={cn('rounded-t px-3 py-1.5 text-small', sheet === id ? 'bg-surface font-semibold text-success-fg shadow-subtle' : 'text-fg-secondary hover:text-fg')}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The CSV text itself (the first rows, exactly as the file has them). */
function CsvPreview({ data }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-small text-fg-secondary">
        <Badge variant="neutral">{data.files.csv}</Badge>
        <span>Data only: no title, summary or formatting.</span>
      </div>
      <pre aria-label="CSV preview" className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-caption whitespace-pre text-fg">
        {data.csv}
      </pre>
    </div>
  );
}

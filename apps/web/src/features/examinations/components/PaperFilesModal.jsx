import { useRef, useState } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { Alert, Badge, Button, LoadingState, Modal, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadPaperFiles, paperFileLink, removePaperFile, uploadPaperFile } from '../data/examApi.js';

const KINDS = [
  { value: 'question_paper', label: 'Question paper' },
  { value: 'marking_scheme', label: 'Marking scheme' },
  { value: 'other', label: 'Other' },
];
const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label ?? k;
const size = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const failure = (e) => (e?.code ? requestFailure(e) : e?.message || 'Something went wrong. Try again.');

/** A paper's files kept in private storage: upload, download (recorded), remove. */
export function PaperFilesModal({ role, paper, className, open, onClose }) {
  const [version, setVersion] = useState(0);
  const [kind, setKind] = useState('question_paper');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const input = useRef(null);
  const data = useApiData(() => (open && paper ? loadPaperFiles(role, paper.id) : Promise.resolve(null)), `paper-files|${paper?.id}|${open}|${version}`);
  const d = data.data;
  const act = async (name, fn, text) => {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
      if (text) setMessage({ variant: 'success', text });
      setVersion((n) => n + 1);
    } catch (e) {
      setMessage({ variant: 'error', text: failure(e) });
    } finally {
      setBusy('');
    }
  };
  const pick = (file) => {
    if (!file) return;
    if (d && !d.types.includes(file.type)) return setMessage({ variant: 'error', text: 'Choose a PDF, a Word file or an image (PNG, JPEG).' });
    if (d && file.size > d.maxBytes) return setMessage({ variant: 'error', text: `The file is larger than ${size(d.maxBytes)}.` });
    return act('upload', () => uploadPaperFile(role, paper.id, file, kind), `${file.name} uploaded.`);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={paper ? `Files · ${paper.subject.name} · ${className ?? ''}` : 'Files'}
      description="Kept in private storage. Downloads use links that expire after two minutes and are recorded in the audit log."
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      {!d ? (
        <LoadingState label="Loading files…" />
      ) : (
        <div className="flex flex-col gap-4">
          {!d.configured && <Alert variant="info" title="File storage is not set up yet">Paper files are kept in a private storage area that EduTrack support connects for your school.</Alert>}
          {message && <Alert variant={message.variant} onDismiss={() => setMessage(null)}>{message.text}</Alert>}
          {d.configured && d.canChange && (
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Kind" options={KINDS} value={kind} onChange={(e) => setKind(e.target.value)} fieldClassName="sm:w-56" />
              <input ref={input} type="file" accept={d.types.join(',')} className="sr-only" aria-label="Choose a file to upload" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
              <Button leftIcon={Upload} loading={busy === 'upload'} onClick={() => input.current?.click()}>Upload File</Button>
              <span className="text-caption text-fg-muted">PDF, Word or image, up to {size(d.maxBytes)}.</span>
            </div>
          )}
          {!d.files.length ? (
            <p className="text-small text-fg-muted">No files yet.</p>
          ) : (
            <Table caption="Files of this paper">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>File</TableHeaderCell>
                  <TableHeaderCell>Kind</TableHeaderCell>
                  <TableHeaderCell>Uploaded</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.files.map((f) => (
                  <TableRow key={f.id} interactive={false}>
                    <TableCell>
                      <span className={f.status === 'removed' ? 'text-fg-muted line-through' : 'font-medium'}>{f.fileName}</span>
                      <span className="block text-caption text-fg-muted">{size(f.size)}{f.status === 'removed' ? ` · removed by ${f.removedBy}` : ''}</span>
                    </TableCell>
                    <TableCell><Badge variant="neutral">{kindLabel(f.kind)}</Badge></TableCell>
                    <TableCell className="text-small">{f.uploadedBy}<span className="block text-caption text-fg-muted">{new Date(f.createdAt).toLocaleString()}</span></TableCell>
                    <TableCell align="right">
                      {f.status === 'ready' && (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" iconOnly leftIcon={Download} aria-label={`Download ${f.fileName}`} loading={busy === `dl-${f.id}`} onClick={() => act(`dl-${f.id}`, async () => { const { url } = await paperFileLink(role, paper.id, f.id); window.location.assign(url); })} />
                          {d.canChange && <Button size="sm" variant="ghost" iconOnly leftIcon={Trash2} aria-label={`Remove ${f.fileName}`} loading={busy === `rm-${f.id}`} onClick={() => act(`rm-${f.id}`, () => removePaperFile(role, paper.id, f.id), `${f.fileName} removed.`)} />}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </Modal>
  );
}

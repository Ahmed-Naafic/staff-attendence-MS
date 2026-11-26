import { useEffect, useRef, useState } from 'react';
import { Download, Eye, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { Alert, Badge, Button, ConfirmModal, LoadingState, Modal, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadPaperFiles, paperFileLink, removePaperFile, uploadPaperFile } from '../data/examApi.js';

const KINDS = [
  { value: 'question_paper', label: 'Question paper' },
  { value: 'marking_scheme', label: 'Marking scheme' },
  { value: 'other', label: 'Other' },
];
const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label ?? k;
const size = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const extensionOf = (name) => (name.includes('.') ? `.${name.split('.').pop().toLowerCase()}` : '');

/** Server messages are written for people; show them for the errors a person can act on. */
function failure(e) {
  if (!e?.code) return e?.message || 'Something went wrong. Try again.';
  if (e.code === 'VALIDATION_ERROR' && e.details) return Object.values(e.details)[0] ?? e.message;
  if ([0, 400, 403, 404, 409, 422, 429, 502, 503].includes(e.status)) return e.message;
  return 'Something went wrong. Try again.';
}

/**
 * A paper's files in private storage: upload (with progress), view, download, replace, remove.
 * Links are requested fresh from the server on every click (they expire after two minutes), so an
 * expired link is never reused. The browser never talks to storage with credentials: it only uses
 * the one-time upload URL and the short-lived download URLs the server hands out.
 */
export function PaperFilesModal({ role, paper, className, open, onClose }) {
  const [version, setVersion] = useState(0);
  const [kind, setKind] = useState('question_paper');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null); // { name, value, replacing }
  const [message, setMessage] = useState(null);
  const [removing, setRemoving] = useState(null);
  const input = useRef(null);
  const replaceTarget = useRef(null);
  const abort = useRef(null);
  const data = useApiData(() => (open && paper ? loadPaperFiles(role, paper.id) : Promise.resolve(null)), `paper-files|${paper?.id}|${open}|${version}`);
  const d = data.data;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!open) abort.current?.abort();
  }, [open]);

  const act = async (name, fn, text) => {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
      if (text) setMessage({ variant: 'success', text });
      setVersion((n) => n + 1);
    } catch (e) {
      if (e?.name !== 'AbortError') setMessage({ variant: 'error', text: failure(e) });
      else setMessage({ variant: 'info', text: 'The upload was cancelled.' });
      setVersion((n) => n + 1);
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  const choose = (target) => {
    replaceTarget.current = target;
    input.current?.click();
  };

  const pick = (file) => {
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (!file || !d) return;
    const accepted = d.accept.split(',');
    if (!accepted.includes(extensionOf(file.name))) return setMessage({ variant: 'error', text: `Choose one of: ${d.allowed.join(', ')}.` });
    if (file.size === 0) return setMessage({ variant: 'error', text: 'The file is empty.' });
    if (file.size > d.maxBytes) return setMessage({ variant: 'error', text: `The file is larger than ${size(d.maxBytes)}.` });
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ name: file.name, value: 0, replacing: target?.fileName });
    return act(
      'upload',
      () => uploadPaperFile(role, paper.id, file, { kind, replaces: target?.id, signal: controller.signal, onProgress: (value) => setProgress((p) => p && { ...p, value }) }),
      target ? `${target.fileName} was replaced by ${file.name}.` : `${file.name} uploaded.`,
    );
  };

  const openLink = (f, mode) =>
    act(`${mode}-${f.id}`, async () => {
      // Open the tab now (inside the click) so pop-up blockers allow it, then point it at the link.
      const tab = mode === 'view' ? window.open('', '_blank') : null;
      try {
        const { url } = await paperFileLink(role, paper.id, f.id, mode);
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else window.location.assign(url);
      } catch (e) {
        tab?.close();
        throw e;
      }
    });

  const uploading = busy === 'upload';
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={paper ? `Files · ${paper.subject.name} · ${className ?? ''}` : 'Files'}
        description="Kept in private storage. Links to view or download expire after two minutes, and every access is recorded in the audit log."
        footer={
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        }
      >
        {!d ? (
          <LoadingState label="Loading files…" />
        ) : (
          <div className="flex flex-col gap-4">
            {!d.configured && (
              <Alert variant="info" title="File storage is not set up yet">
                Paper files are kept in a private storage area that EduTrack support connects for your school.
              </Alert>
            )}
            {message && (
              <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
                {message.text}
              </Alert>
            )}
            <input
              ref={input}
              type="file"
              accept={d.accept}
              className="sr-only"
              aria-label="Choose a file to upload"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {d.configured && d.canChange && (
              <div className="flex flex-wrap items-end gap-3">
                <Select label="Kind" options={KINDS} value={kind} onChange={(e) => setKind(e.target.value)} fieldClassName="sm:w-56" disabled={uploading} />
                <Button leftIcon={Upload} loading={uploading && !progress?.replacing} disabled={uploading} onClick={() => choose(null)}>
                  Upload File
                </Button>
                <span className="text-caption text-fg-muted">
                  {d.allowed.join(', ')} · up to {size(d.maxBytes)}.
                </span>
              </div>
            )}
            {progress && (
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-3" role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-small">
                  <span className="truncate">
                    {progress.replacing ? `Replacing ${progress.replacing} with ` : 'Uploading '}
                    <span className="font-medium">{progress.name}</span>
                    {progress.value >= 1 ? ' · checking…' : ` · ${Math.round(progress.value * 100)}%`}
                  </span>
                  {progress.value < 1 && (
                    <Button size="sm" variant="ghost" leftIcon={X} onClick={() => abort.current?.abort()}>
                      Cancel
                    </Button>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress.value * 100)}%` }} />
                </div>
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
                  {d.files.map((f) => {
                    const gone = f.status !== 'ready';
                    return (
                      <TableRow key={f.id} interactive={false}>
                        <TableCell>
                          <span className={gone ? 'text-fg-muted line-through' : 'font-medium'}>{f.fileName}</span>
                          <span className="block text-caption text-fg-muted">
                            {f.type} · {size(f.size)}
                            {f.status === 'removed' ? ` · removed by ${f.removedBy}` : ''}
                            {f.status === 'replaced' ? ` · replaced by ${f.removedBy}` : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral">{kindLabel(f.kind)}</Badge>
                          {gone && (
                            <Badge variant="neutral" className="ml-1">
                              {f.status === 'replaced' ? 'Replaced' : 'Removed'}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-small">
                          {f.uploadedBy}
                          <span className="block text-caption text-fg-muted">{new Date(f.createdAt).toLocaleString()}</span>
                        </TableCell>
                        <TableCell align="right">
                          {!gone && (
                            <span className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                iconOnly
                                leftIcon={Eye}
                                aria-label={`View ${f.fileName}`}
                                loading={busy === `view-${f.id}`}
                                disabled={!d.configured}
                                onClick={() => openLink(f, 'view')}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                iconOnly
                                leftIcon={Download}
                                aria-label={`Download ${f.fileName}`}
                                loading={busy === `download-${f.id}`}
                                disabled={!d.configured}
                                onClick={() => openLink(f, 'download')}
                              />
                              {d.canChange && d.configured && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  iconOnly
                                  leftIcon={RefreshCw}
                                  aria-label={`Replace ${f.fileName}`}
                                  disabled={uploading}
                                  loading={uploading && progress?.replacing === f.fileName}
                                  onClick={() => choose(f)}
                                />
                              )}
                              {d.canChange && <Button size="sm" variant="ghost" iconOnly leftIcon={Trash2} aria-label={`Remove ${f.fileName}`} disabled={uploading} onClick={() => setRemoving(f)} />}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove file?"
        description={removing ? `${removing.fileName} will be deleted from storage. The record of who uploaded and removed it stays.` : ''}
        confirmLabel="Remove File"
        run={() => removePaperFile(role, paper.id, removing.id)}
        onDone={() => {
          setMessage({ variant: 'success', text: `${removing.fileName} removed.` });
          setRemoving(null);
          setVersion((n) => n + 1);
        }}
      />
    </>
  );
}

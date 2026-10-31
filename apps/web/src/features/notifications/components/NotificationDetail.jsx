import { ExternalLink } from 'lucide-react';
import { Badge, LinkButton, Modal, Table, TableBody, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format.js';
import { CATEGORY_LABELS, digestSummary, linkTarget, utcLabel } from '../utils/notificationRules.js';

function Counts({ rows }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map((r) => (
        <div key={r.key} className="rounded-md border border-border-subtle bg-surface px-3 py-2">
          <dt className="text-caption text-fg-muted">{r.label}</dt>
          <dd className="text-section-title text-fg">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The digest counts: the day, the final figures of the day before, and (school digest) each branch. Counts only; absence is not calculated. */
function DigestView({ data }) {
  const digest = digestSummary(data);
  if (!digest) return null;
  return (
    <section aria-label="Digest figures" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-card-title text-fg">Work date {digest.date}</h3>
        <Counts rows={digest.day} />
      </div>
      {digest.previous && (
        <div className="flex flex-col gap-2">
          <h3 className="text-card-title text-fg">{digest.previous.date} (final)</h3>
          <Counts rows={digest.previous.rows} />
        </div>
      )}
      {digest.branches.length > 0 && (
        <TableContainer label="Branches">
          <Table caption={`Branches on ${digest.date}`}>
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Branch</TableHeaderCell>
                <TableHeaderCell align="right">Check-ins</TableHeaderCell>
                <TableHeaderCell align="right">Late</TableHeaderCell>
                <TableHeaderCell align="right">Not checked out yet</TableHeaderCell>
                <TableHeaderCell align="right">No check-out (day before)</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {digest.branches.map((b) => (
                <TableRow key={b.code} interactive={false}>
                  <TableCell>
                    {b.name} <span className="text-fg-muted">({b.code})</span>
                  </TableCell>
                  <TableCell align="right">{b.checkIns}</TableCell>
                  <TableCell align="right">{b.late}</TableCell>
                  <TableCell align="right">{b.open}</TableCell>
                  <TableCell align="right">{b.missing}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <p className="text-small text-fg-muted">Counts only. Absence is not calculated.</p>
    </section>
  );
}

/** Details of one notification or announcement (the text is Somali, as stored). */
export function NotificationDetail({ item, role, onClose }) {
  if (!item) return null;
  const target = linkTarget(item, role);
  return (
    <Modal
      open
      onClose={onClose}
      // The school digest has a branch table: the widest size, so its columns fit.
      size={item.type === 'SCHOOL_DIGEST' ? 'xl' : item.category === 'DIGEST' ? 'lg' : 'md'}
      title={<span lang={item.language}>{item.title}</span>}
      description={`${CATEGORY_LABELS[item.category] ?? item.category} · ${utcLabel(formatDateTime(item.createdAt))}`}
      footer={
        target && (
          <LinkButton to={target} variant="primary" onClick={onClose}>
            Open
          </LinkButton>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {item.source === 'announcement' && <Badge variant="accent">Platform announcement</Badge>}
        {item.imageUrl && <img src={item.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="max-h-64 w-full rounded-md border border-border-subtle object-cover" />}
        <p lang={item.language} className="whitespace-pre-line text-body text-fg">
          {item.body}
        </p>
        {item.category === 'DIGEST' && <DigestView data={item.data} />}
        {item.linkUrl && (
          <a href={item.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-small font-medium text-info-fg underline">
            Open the guide <ExternalLink aria-hidden="true" className="size-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        <p className="text-caption text-fg-muted">Kept until {utcLabel(formatDateTime(item.expiresAt))}.</p>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Modal, RadioGroup, Select, Textarea } from '../../../components/ui';
import { createAnnouncement, searchSchools, updateAnnouncement } from '../data/announcementsApi.js';
import { BODY_MAX, emptyForm, formFrom, KINDS, ROLES, TITLE_MAX, toBody, validateAnnouncement } from '../utils/announcementRules.js';

const PUBLISH = [
  { value: 'publish', label: 'Publish now' },
  { value: 'schedule', label: 'Schedule', description: 'Shown from the chosen time.' },
  { value: 'draft', label: 'Save as draft', description: 'Not shown to anyone until you publish it.' },
];

/** Schools for "Selected schools": search, add, remove. */
function SchoolPicker({ selected, onChange, error, disabled }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSchools(q.trim() || undefined, controller.signal)
        .then(setResults)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  const chosen = new Set(selected.map((s) => s.id));
  return (
    <div className="flex flex-col gap-2">
      <Input label="Find schools" type="search" value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled} error={error} />
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Selected schools">
          {selected.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-1 text-small text-fg">
              {s.name} <span className="text-fg-muted">({s.code})</span>
              <button type="button" aria-label={`Remove ${s.name}`} disabled={disabled} onClick={() => onChange(selected.filter((x) => x.id !== s.id))} className="rounded-sm p-0.5 hover:bg-border-subtle">
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="max-h-40 overflow-y-auto rounded-md border border-border-subtle" aria-label="Schools found">
        {results
          .filter((s) => !chosen.has(s.id))
          .slice(0, 30)
          .map((s) => (
            <li key={s.id}>
              <button type="button" disabled={disabled} onClick={() => onChange([...selected, { id: s.id, name: s.name, code: s.code }])} className="w-full px-3 py-2 text-left text-small hover:bg-muted">
                {s.name} <span className="text-fg-muted">({s.code})</span>
              </button>
            </li>
          ))}
        {!results.length && <li className="px-3 py-2 text-small text-fg-muted">No schools found.</li>}
      </ul>
    </div>
  );
}

/**
 * Create or edit a platform announcement. Title and message are written in Somali (the approved
 * notification language). The audience is roles plus all schools or selected schools; the server
 * checks everything again and shows it only to that audience.
 */
export function AnnouncementFormModal({ announcement, onClose, onSaved }) {
  const create = !announcement;
  const [form, setForm] = useState(() => (create ? emptyForm() : formFrom(announcement)));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleRole = (role, on) => set('roles', on ? [...form.roles, role] : form.roles.filter((r) => r !== role));

  async function submit(event) {
    event.preventDefault();
    const found = validateAnnouncement(form, { saved: announcement });
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const saved = create ? await createAnnouncement(toBody(form, { create: true })) : await updateAnnouncement(announcement.id, toBody(form, { create: false }));
      onSaved(saved, create ? form.action : 'edit');
    } catch (error) {
      if (error.details) setErrors(error.details);
      if (error.status !== 401) setFormError(error.details ? 'Check the highlighted fields.' : error.message);
    } finally {
      setSaving(false);
    }
  }

  const submitLabel = !create ? 'Save changes' : form.action === 'draft' ? 'Save draft' : form.action === 'schedule' ? 'Schedule' : 'Publish';
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      loading={saving}
      title={create ? 'New announcement' : 'Edit announcement'}
      description="Write the title and message in Somali."
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="announcement-form" loading={saving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="announcement-form" noValidate onSubmit={submit} className="flex flex-col gap-5">
        <Select label="Type" options={KINDS} value={form.kind} onChange={(e) => set('kind', e.target.value)} error={errors.kind} />
        <Input label="Title (Somali)" lang="so" required maxLength={TITLE_MAX} value={form.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
        <Textarea
          label="Message (Somali)"
          lang="so"
          required
          rows={6}
          maxLength={BODY_MAX}
          value={form.body}
          hint={`${[...form.body].length}/${BODY_MAX}`}
          onChange={(e) => set('body', e.target.value)}
          error={errors.body}
        />
        <Input label="Image address (optional)" type="url" placeholder="https://" value={form.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} error={errors.imageUrl} hint="An https:// image shown with the announcement." />
        <Input label="Guide link (optional)" type="url" placeholder="https://" value={form.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} error={errors.linkUrl} hint="A tutorial or guide that opens in a new tab." />

        <fieldset className="flex flex-col gap-2" aria-invalid={errors.roles ? true : undefined}>
          <legend className="mb-1 text-label text-fg">Audience</legend>
          {ROLES.map((r) => (
            <Checkbox key={r.value} label={r.label} description={r.description} checked={form.roles.includes(r.value)} onChange={(e) => toggleRole(r.value, e.target.checked)} />
          ))}
          {errors.roles && <p className="text-small text-error-fg">{errors.roles}</p>}
        </fieldset>
        <RadioGroup
          legend="Schools"
          orientation="horizontal"
          value={form.allSchools ? 'all' : 'selected'}
          onChange={(v) => set('allSchools', v === 'all')}
          options={[
            { value: 'all', label: 'All schools' },
            { value: 'selected', label: 'Selected schools' },
          ]}
        />
        {!form.allSchools && <SchoolPicker selected={form.schools} onChange={(s) => set('schools', s)} error={errors.schoolIds} disabled={saving} />}

        {create && <RadioGroup legend="Publishing" value={form.action} onChange={(v) => set('action', v)} options={PUBLISH} />}
        {create && form.action === 'schedule' && (
          <Input label="Publish at" type="datetime-local" value={form.publishAt} onChange={(e) => set('publishAt', e.target.value)} error={errors.publishAt} hint="In your browser's time zone." />
        )}
        <Input
          label="Expires at"
          type="datetime-local"
          required
          value={form.expiresAt}
          onChange={(e) => set('expiresAt', e.target.value)}
          error={errors.expiresAt}
          hint="In your browser's time zone. At most 90 days after it is published."
        />
        {!create && announcement.status !== 'draft' && <Alert variant="info">Changes are shown at once to everyone in the audience. Push notifications are not sent again.</Alert>}
      </form>
    </Modal>
  );
}

import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, Input, Modal, Select, Switch, Textarea } from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { createExamType, createPeriod, createRoom, createScale, updateExamType, updatePeriod, updateRoom, updateScale } from '../data/examApi.js';
import { checkBands, emptyBand, LETTER_SCALE } from '../utils/examRules.js';

const failure = (error) => requestFailure(error);
const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const whole = (v, min, max) => {
  const n = Number(String(v).trim());
  return String(v).trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
/** Only the fields that changed (an edit sends nothing else). */
const changed = (values, before) => Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== before[k]));

function Footer({ formId, saving, onClose, label }) {
  return (
    <>
      <Button variant="outline" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={saving}>
        {label}
      </Button>
    </>
  );
}

/** Add (period null) or edit an academic period of a year (School Owner). `year`: { id, name, startDate, endDate }. */
export function PeriodModal({ role, year, period, open, onClose, onSaved }) {
  const formId = useId();
  const form = useDialogForm(open, { name: period?.name ?? '', startDate: period?.startDate ?? '', endDate: period?.endDate ?? '' }, failure);
  const v = form.values;
  const save = () => {
    const problems = {};
    const name = clean(v.name);
    if (!name || name.length > 60) problems.name = 'Name: 1–60 characters.';
    if (!v.startDate) problems.startDate = 'Choose the date.';
    if (!v.endDate) problems.endDate = 'Choose the date.';
    if (v.startDate && v.endDate && v.endDate < v.startDate) problems.endDate = 'The end is before the start.';
    if (year && v.startDate && (v.startDate < year.startDate || v.startDate > year.endDate)) problems.startDate = `Inside ${year.name}: ${year.startDate} to ${year.endDate}.`;
    if (year && v.endDate && (v.endDate > year.endDate || v.endDate < year.startDate)) problems.endDate = `Inside ${year.name}: ${year.startDate} to ${year.endDate}.`;
    const values = { name, startDate: v.startDate, endDate: v.endDate };
    if (period) {
      const body = changed(values, period);
      if (!Object.keys(body).length) return onSaved(period);
      return form.submit(problems, ['name', 'startDate', 'endDate'], () => updatePeriod(role, period.id, body), onSaved);
    }
    return form.submit(problems, ['name', 'startDate', 'endDate'], () => createPeriod(role, { academicYear: year.id, ...values }), onSaved);
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: v[name], error: form.errors[name], onChange: (e) => form.set(name, e.target.value) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={period ? 'Edit Academic Period' : 'Add Academic Period'}
      description={year ? `A term or semester of ${year.name} (${year.startDate} to ${year.endDate}). Periods cannot overlap.` : undefined}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={period ? 'Save Changes' : 'Add Period'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Name" required autoComplete="off" placeholder="Term 1" fieldClassName="sm:col-span-2" {...field('name')} />
        <Input type="date" label="Starts" required min={year?.startDate} max={year?.endDate} {...field('startDate')} />
        <Input type="date" label="Ends" required min={v.startDate || year?.startDate} max={year?.endDate} {...field('endDate')} />
      </form>
    </Modal>
  );
}

/** Add (type null) or edit an examination type (School Owner). `scales`: active grading scales. */
export function ExamTypeModal({ role, type, scales, maxMarksLimit = 1000, open, onClose, onSaved }) {
  const formId = useId();
  const form = useDialogForm(
    open,
    { name: type?.name ?? '', description: type?.description ?? '', defaultMaxMarks: String(type?.defaultMaxMarks ?? 100), stopsLessons: type?.stopsLessons ?? true, gradingScale: type?.gradingScale?.id ?? '' },
    failure,
  );
  const v = form.values;
  const save = () => {
    const problems = {};
    const name = clean(v.name);
    if (!name || name.length > 60) problems.name = 'Name: 1–60 characters.';
    const marks = whole(v.defaultMaxMarks, 1, maxMarksLimit);
    if (marks === null) problems.defaultMaxMarks = `A whole number from 1 to ${maxMarksLimit}.`;
    const values = { name, description: clean(v.description) || null, defaultMaxMarks: marks, stopsLessons: v.stopsLessons, gradingScale: v.gradingScale || null };
    const fields = ['name', 'description', 'defaultMaxMarks', 'stopsLessons', 'gradingScale'];
    if (type) {
      const body = changed(values, { ...type, description: type.description || null, gradingScale: type.gradingScale?.id ?? null });
      if (!Object.keys(body).length) return onSaved(type);
      return form.submit(problems, fields, () => updateExamType(role, type.id, body), onSaved);
    }
    return form.submit(problems, fields, () => createExamType(role, values), onSaved);
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: v[name], error: form.errors[name], onChange: (e) => form.set(name, e.target.value) });
  const options = [{ value: '', label: 'The school default scale' }, ...scales.filter((s) => s.status === 'active' || s.id === v.gradingScale).map((s) => ({ value: s.id, label: s.name }))];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={type ? 'Edit Examination Type' : 'Add Examination Type'}
      description="Mid-Term, Final, Monthly Test… Every examination is of one type."
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={type ? 'Save Changes' : 'Add Type'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input label="Name" required autoComplete="off" placeholder="Mid-Term" fieldClassName="sm:col-span-2" {...field('name')} />
        <Input label="Marks out of" required inputMode="numeric" hint="Default for each paper." {...field('defaultMaxMarks')} />
        <Select label="Grading scale" options={options} fieldClassName="sm:col-span-3" {...field('gradingScale')} />
        <Textarea label="Description" rows={2} hint="Optional." fieldClassName="sm:col-span-3" {...field('description')} />
        <Switch
          className="sm:col-span-3"
          label="Stops normal lessons"
          description="On examination days, lessons stop for the classes sitting it (only in the branches holding it). Off for short tests taken during lessons."
          checked={v.stopsLessons}
          onChange={(next) => form.set('stopsLessons', next)}
        />
      </form>
    </Modal>
  );
}

/** Add (scale null) or edit a grading scale and its grades (School Owner). */
export function ScaleModal({ role, scale, open, onClose, onSaved }) {
  const formId = useId();
  const rows = scale ? scale.bands.map((b) => ({ label: b.label, minPercent: String(b.minPercent), maxPercent: String(b.maxPercent), points: b.points === null ? '' : String(b.points), passes: b.passes, remark: b.remark ?? '' })) : LETTER_SCALE.map((b) => ({ ...b, remark: '' }));
  const form = useDialogForm(open, { name: scale?.name ?? '', isDefault: scale?.isDefault ?? false, bands: rows }, failure);
  const v = form.values;
  const setBand = (i, key, value) => form.set('bands', v.bands.map((b, j) => (j === i ? { ...b, [key]: value } : b)));
  const save = () => {
    const name = clean(v.name);
    const checked = checkBands(v.bands);
    const problems = { ...(checked.details ?? {}) };
    if (!name || name.length > 60) problems.name = 'Name: 1–60 characters.';
    if (checked.error && !checked.details) problems.bands = checked.error;
    else if (checked.error) problems.bands = checked.error;
    const body = scale ? { ...(name !== scale.name && { name }), ...(v.isDefault && !scale.isDefault && { isDefault: true }), bands: checked.bands } : { name, isDefault: v.isDefault, bands: checked.bands };
    return form.submit(problems, ['name', 'bands'], () => (scale ? updateScale(role, scale.id, body) : createScale(role, body)), onSaved);
  };
  const err = (i, key) => form.errors[`bands.${i}.${key}`];
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={scale ? `Edit ${scale.name}` : 'Add Grading Scale'}
      description="The grades cover 0–100% once, highest first. Results already calculated keep the grade they got."
      loading={form.saving}
      error={form.formError || form.errors.bands}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={scale ? 'Save Changes' : 'Add Scale'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
          <Input label="Name" required autoComplete="off" placeholder="Letter grades (A–F)" id={`${formId}-name`} value={v.name} error={form.errors.name} onChange={(e) => form.set('name', e.target.value)} />
          {!scale?.isDefault && <Checkbox label="The school’s default scale" description="Used by examination types without their own scale." checked={v.isDefault} onChange={(e) => form.set('isDefault', e.target.checked)} />}
        </div>
        <div role="region" aria-label="Grades" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-body">
            <thead className="text-small text-fg-muted">
              <tr>
                <th className="py-2 pr-2 font-medium">Grade</th>
                <th className="py-2 pr-2 font-medium">From %</th>
                <th className="py-2 pr-2 font-medium">To %</th>
                <th className="py-2 pr-2 font-medium">Points</th>
                <th className="py-2 pr-2 font-medium">Remark</th>
                <th className="py-2 pr-2 font-medium">Passes</th>
                <th className="py-2" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {v.bands.map((b, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2"><Input label={`Grade ${i + 1}`} hideLabel className="w-20" value={b.label} error={err(i, 'label')} onChange={(e) => setBand(i, 'label', e.target.value)} /></td>
                  <td className="py-1 pr-2"><Input label={`From, grade ${i + 1}`} hideLabel inputMode="decimal" className="w-24" value={b.minPercent} error={err(i, 'minPercent')} onChange={(e) => setBand(i, 'minPercent', e.target.value)} /></td>
                  <td className="py-1 pr-2"><Input label={`To, grade ${i + 1}`} hideLabel inputMode="decimal" className="w-24" value={b.maxPercent} error={err(i, 'maxPercent')} onChange={(e) => setBand(i, 'maxPercent', e.target.value)} /></td>
                  <td className="py-1 pr-2"><Input label={`Points, grade ${i + 1}`} hideLabel inputMode="decimal" className="w-20" placeholder="—" value={b.points} error={err(i, 'points')} onChange={(e) => setBand(i, 'points', e.target.value)} /></td>
                  <td className="py-1 pr-2"><Input label={`Remark, grade ${i + 1}`} hideLabel className="w-40" placeholder="Excellent" value={b.remark} onChange={(e) => setBand(i, 'remark', e.target.value)} /></td>
                  <td className="py-3 pr-2"><Checkbox aria-label={`Passes, grade ${i + 1}`} checked={b.passes} onChange={(e) => setBand(i, 'passes', e.target.checked)} /></td>
                  <td className="py-1">
                    <Button size="sm" variant="ghost" iconOnly aria-label={`Remove grade ${b.label || i + 1}`} leftIcon={Trash2} disabled={v.bands.length <= 2} onClick={() => form.set('bands', v.bands.filter((_, j) => j !== i))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button size="sm" variant="outline" leftIcon={Plus} disabled={v.bands.length >= 20} onClick={() => form.set('bands', [...v.bands, emptyBand()])}>
            Add Grade
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Add (room null) or edit an examination room: name and default capacity only. The Owner chooses the branch when adding. */
export function RoomModal({ role, room, branches = [], defaultBranch = '', open, onClose, onSaved }) {
  const formId = useId();
  const form = useDialogForm(open, { name: room?.name ?? '', defaultCapacity: room ? String(room.defaultCapacity) : '', branch: defaultBranch }, failure);
  const v = form.values;
  const owner = role === 'OWNER';
  const save = () => {
    const problems = {};
    const name = clean(v.name);
    if (!name || name.length > 40) problems.name = 'Room: 1–40 characters.';
    const capacity = whole(v.defaultCapacity, 1, 500);
    if (capacity === null) problems.defaultCapacity = 'A whole number from 1 to 500.';
    if (!room && owner && !v.branch) problems.branch = 'Choose the branch.';
    if (room) {
      const body = changed({ name, defaultCapacity: capacity }, room);
      if (!Object.keys(body).length) return onSaved(room);
      return form.submit(problems, ['name', 'defaultCapacity'], () => updateRoom(role, room.id, body), onSaved);
    }
    return form.submit(problems, ['name', 'defaultCapacity', 'branch'], () => createRoom(role, { name, defaultCapacity: capacity, ...(owner && { branch: v.branch }) }), onSaved);
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: v[name], error: form.errors[name], onChange: (e) => form.set(name, e.target.value) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={room ? 'Edit Room' : 'Add Room'}
      description={room ? room.branch.name : 'A room used for examinations. Each examination can set its own capacity for the room.'}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={room ? 'Save Changes' : 'Add Room'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        {!room && owner && <Select label="Branch" required options={[{ value: '', label: 'Choose a branch' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} {...field('branch')} />}
        <Input label="Room" required autoComplete="off" placeholder="R1" {...field('name')} />
        <Input label="Default capacity" required inputMode="numeric" hint="Students seated for an examination." {...field('defaultCapacity')} />
      </form>
    </Modal>
  );
}

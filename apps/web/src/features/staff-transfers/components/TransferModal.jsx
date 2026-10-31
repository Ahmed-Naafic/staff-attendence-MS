import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Modal, Select, Spinner } from '../../../components/ui';
import { dayList, WEEKDAYS } from '../../schedules/utils/scheduleRules.js';
import { loadBranchShifts, scheduleTransfer } from '../data/transfersApi.js';
import { destinationOptions, emptyTransfer, overlapProblems, shiftSummary, toggleDay, toggleShift, toTransferBody, validateTransfer } from '../utils/transferRules.js';

/** The destination's shifts on the transfer date, each with its working days to keep or drop. */
function ShiftPicker({ shifts, chosen, problems, onChange, disabled }) {
  if (!shifts.length) return <p className="text-small text-fg-muted">The destination branch has no shifts on this date.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {shifts.map((s) => (
        <li key={s.key} className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
          <Checkbox
            label={`${s.name} · ${s.start}–${s.end}`}
            description={dayList(s.days)}
            checked={Boolean(chosen[s.key])}
            disabled={disabled}
            onChange={(e) => onChange(toggleShift(chosen, s, e.target.checked))}
          />
          {chosen[s.key] && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 pl-7" role="group" aria-label={`Days of ${s.name}`}>
              {WEEKDAYS.filter((d) => s.days.includes(d.value)).map((d) => (
                <Checkbox key={d.value} label={d.label} checked={chosen[s.key].includes(d.value)} disabled={disabled} onChange={(e) => onChange(toggleDay(chosen, s.key, d.value, e.target.checked))} />
              ))}
            </div>
          )}
          {problems[s.key] && <p className="pl-7 text-small text-error-fg">{problems[s.key]}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Transfer to another branch (School Owner): the current branch, the destination (active branches
 * of the school), the date it takes effect (tomorrow at the earliest) and the destination shifts,
 * then a review step and confirmation. The server checks everything again.
 */
export function TransferModal({ staff, branches, onClose, onDone }) {
  const [form, setForm] = useState(() => emptyTransfer(staff.earliestTransferDate));
  const [step, setStep] = useState('edit');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [shifts, setShifts] = useState({ status: 'idle', list: [], schedule: null });
  const options = destinationOptions(branches, staff.branch.id);
  const destination = branches.find((b) => b.id === form.branchId);

  // The destination's shifts in the schedule in effect on the chosen date.
  useEffect(() => {
    if (!form.branchId || !/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveFrom)) return undefined;
    const controller = new AbortController();
    setShifts((s) => ({ ...s, status: 'loading' }));
    loadBranchShifts(form.branchId, form.effectiveFrom, controller.signal)
      .then((data) => {
        setShifts({ status: 'ready', list: data.schedule?.shifts ?? [], schedule: data.schedule });
        setForm((f) => ({ ...f, shifts: Object.fromEntries(Object.entries(f.shifts).filter(([k]) => data.schedule?.shifts.some((s) => s.key === k))) }));
      })
      .catch((error) => error.name !== 'AbortError' && setShifts({ status: 'error', list: [], schedule: null }));
    return () => controller.abort();
  }, [form.branchId, form.effectiveFrom]);

  const problems = overlapProblems(form, shifts.list);
  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function review(event) {
    event.preventDefault();
    const found = validateTransfer(form, { earliest: staff.earliestTransferDate, latest: staff.latestTransferDate });
    setErrors(found);
    if (Object.keys(found).length || Object.keys(problems).length || shifts.status !== 'ready') return;
    setStep('review');
  }

  async function confirm() {
    setSaving(true);
    setFormError('');
    try {
      const transfer = await scheduleTransfer(staff.id, toTransferBody(form, shifts.list));
      onDone(transfer);
    } catch (error) {
      if (error.details) {
        setErrors(error.details);
        setStep('edit');
      }
      if (error.status !== 401) setFormError(error.code === 'TRANSFER_SCHEDULED' ? error.message : error.details ? 'Check the highlighted fields.' : error.message);
    } finally {
      setSaving(false);
    }
  }

  const summary = shiftSummary(form, shifts.list, dayList);
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      loading={saving}
      loadingLabel="Scheduling the transfer…"
      title={`Transfer ${staff.name}`}
      description={step === 'edit' ? 'Choose the branch, the date and the shifts at the new branch.' : 'Check the transfer, then confirm it.'}
      error={formError}
      footer={
        step === 'edit' ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="transfer-form" disabled={!options.length}>
              Review Transfer
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setStep('edit')} disabled={saving}>
              Back
            </Button>
            <Button onClick={confirm} loading={saving}>
              Confirm Transfer
            </Button>
          </>
        )
      }
    >
      {step === 'edit' ? (
        <form id="transfer-form" noValidate onSubmit={review} className="flex flex-col gap-5">
          <div className="rounded-md border border-border-subtle bg-muted px-4 py-3 text-small">
            <span className="text-fg-muted">Current branch: </span>
            <span className="font-medium text-fg">
              {staff.branch.name} ({staff.branch.code})
            </span>
          </div>
          {!options.length && <Alert variant="warning">Your school has no other active branch to transfer to.</Alert>}
          <Select
            label="Destination branch"
            required
            placeholder="Choose a branch"
            options={options}
            value={form.branchId}
            onChange={(e) => set('branchId', e.target.value)}
            error={errors.branchId}
          />
          <Input
            label="Takes effect on"
            type="date"
            required
            min={staff.earliestTransferDate}
            max={staff.latestTransferDate}
            value={form.effectiveFrom}
            onChange={(e) => set('effectiveFrom', e.target.value)}
            error={errors.effectiveFrom}
            hint={`From 00:00 (${staff.timeZone}). Until then the staff member works at the current branch; an open check-in can still be checked out there that day.`}
          />
          {form.branchId && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-label text-fg">Shifts at the new branch</legend>
              {shifts.status === 'loading' && <Spinner size="sm" label="Loading the branch's shifts" />}
              {shifts.status === 'error' && <p className="text-small text-error-fg">The branch's shifts could not be loaded. Try again.</p>}
              {shifts.status === 'ready' && !shifts.schedule && (
                <p className="text-small text-fg-muted">This branch has no schedule in effect on this date. The staff member starts with no shifts; its Manager can assign them later.</p>
              )}
              {shifts.status === 'ready' && shifts.schedule && (
                <>
                  <p className="text-small text-fg-muted">Choose none to let the branch's Manager assign shifts later (until then the staff member cannot check in there).</p>
                  <ShiftPicker shifts={shifts.list} chosen={form.shifts} problems={{ ...problems, ...Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('shifts.'))) }} onChange={(v) => set('shifts', v)} />
                </>
              )}
            </fieldset>
          )}
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-body">
            <span className="font-medium text-fg">
              {staff.branch.name} ({staff.branch.code})
            </span>
            <ArrowRight aria-label="to" className="size-4 text-fg-muted" />
            <span className="font-medium text-fg">
              {destination?.name} ({destination?.code})
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-small sm:grid-cols-[10rem_1fr]">
            <dt className="text-fg-muted">Staff member</dt>
            <dd className="text-fg">
              {staff.name} · {staff.staffId} (the Staff ID does not change)
            </dd>
            <dt className="text-fg-muted">Takes effect</dt>
            <dd className="text-fg">
              {form.effectiveFrom} at 00:00 ({staff.timeZone})
            </dd>
            <dt className="text-fg-muted">Shifts at the new branch</dt>
            <dd className="text-fg">{summary.length ? summary.map((line) => <div key={line}>{line}</div>) : 'None yet (the branch’s Manager assigns them)'}</dd>
          </dl>
          <Alert variant="info">
            Past attendance stays with the branch where it was recorded. Assignment changes scheduled from this date are cancelled. The staff member and the new branch’s
            Managers are notified.
          </Alert>
        </div>
      )}
    </Modal>
  );
}

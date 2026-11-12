import { useEffect, useId, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { loadAcademicYears } from '../../academic-years';
import { enrollStudent, registerStudent, transferOut, updateEnrollment, updateStudent } from '../data/studentsApi.js';
import { cleanProfile, EMPTY_PROFILE, PROFILE_FIELDS, validateProfile } from '../utils/studentRules.js';
import { apiRequest } from '../../../lib/api.js';

const KNOWN = [
  'POSSIBLE_DUPLICATE',
  'ALREADY_ENROLLED',
  'YEAR_CLOSED',
  'SECTION_INACTIVE',
  'CLASS_INACTIVE',
  'WRONG_YEAR',
  'STUDENT_GRADUATED',
  'ENROLLMENT_ENDED',
  'INVALID_STATUS',
  'BRANCH_NOT_OPERATING',
];
const failure = (error, what) => (KNOWN.includes(error.code) || error.status === 0 ? error.message : error.status === 404 ? `This ${what} no longer exists, or is not part of your scope.` : `The ${what} could not be saved. Try again.`);

/** Shared dialog state with one save at a time. */
function useSave(open) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [once] = useState(createSingleFlight);
  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
  }, [open]);
  const run = (work, what, onFail) =>
    once(async () => {
      setError('');
      setSaving(true);
      try {
        await work();
      } catch (failed) {
        if (!onFail?.(failed)) setError(failure(failed, what));
      } finally {
        setSaving(false);
      }
    });
  return { error, setError, saving, run };
}

function Footer({ onClose, saving, formId, label, variant = 'primary', onClick }) {
  return (
    <>
      <Button variant="outline" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button type={formId ? 'submit' : 'button'} form={formId} variant={variant} loading={saving} onClick={onClick}>
        {label}
      </Button>
    </>
  );
}

/**
 * Register a student (mode "create"; an Owner chooses the branch) or edit a profile. No class or section
 * is chosen here: enrollment is separate. A possible duplicate (same name and date of birth) is shown
 * and can be confirmed explicitly.
 */
export function StudentFormModal({ role, mode, student, branches, open, onClose, onSaved }) {
  const formId = useId();
  const isCreate = mode === 'create';
  const owner = role === 'OWNER';
  const [values, setValues] = useState(EMPTY_PROFILE);
  const [branchId, setBranchId] = useState('');
  const [errors, setErrors] = useState({});
  const [duplicate, setDuplicate] = useState(null);
  const save = useSave(open);

  useEffect(() => {
    if (!open) return;
    setValues(isCreate || !student ? EMPTY_PROFILE : Object.fromEntries(PROFILE_FIELDS.map((f) => [f, student[f] ?? ''])));
    setBranchId('');
    setErrors({});
    setDuplicate(null);
  }, [open, isCreate, student]);

  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors(({ [field]: _removed, ...rest }) => rest);
    setDuplicate(null);
  };

  function submit(event, confirmDuplicate = false) {
    event?.preventDefault();
    const problems = validateProfile(values);
    if (isCreate && owner && !branchId) problems.branchId = 'Choose a branch.';
    setErrors(problems);
    const first = [...PROFILE_FIELDS, 'branchId'].find((f) => problems[f]);
    if (first) return document.getElementById(`${formId}-${first}`)?.focus();
    const profile = cleanProfile(values);
    const body = isCreate
      ? { ...profile, ...(owner && { branchId }), ...(confirmDuplicate && { confirmDuplicate: true }) }
      : Object.fromEntries(Object.entries(profile).filter(([f, v]) => (v ?? '') !== ((f === 'gender' ? student.gender?.toUpperCase() : student[f]) ?? '')));
    if (!isCreate && !Object.keys(body).length) return onSaved(student);
    return save.run(
      async () => onSaved(isCreate ? await registerStudent(role, body) : await updateStudent(role, student.id, body)),
      'student',
      (failed) => {
        if (failed.code === 'POSSIBLE_DUPLICATE') {
          setDuplicate(failed.message);
          return true;
        }
        if (failed.details) setErrors(failed.details);
        return false;
      },
    );
  }

  const field = (name, props = {}) => ({ id: `${formId}-${name}`, value: values[name], onChange: set(name), error: errors[name], ...props });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isCreate ? 'Register Student' : 'Edit Student'}
      description={isCreate ? 'A student is registered once. Enroll them in a section afterwards, for each academic year.' : `Student ID ${student?.studentNumber ?? ''} cannot be changed.`}
      loading={save.saving}
      loadingLabel="Saving…"
      error={save.error}
      footer={
        duplicate ? (
          <>
            <Button variant="outline" onClick={() => setDuplicate(null)} disabled={save.saving}>
              Go back
            </Button>
            <Button variant="secondary" loading={save.saving} onClick={() => submit(null, true)}>
              Register anyway
            </Button>
          </>
        ) : (
          <Footer onClose={onClose} saving={save.saving} formId={formId} label={isCreate ? 'Register Student' : 'Save Changes'} />
        )
      }
    >
      {duplicate && (
        <Alert variant="warning" title="This may be a duplicate">
          {duplicate}
        </Alert>
      )}
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {isCreate && owner && (
          <Select
            id={`${formId}-branchId`}
            label="Branch"
            required
            options={[{ value: '', label: 'Choose a branch' }, ...(branches ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
            value={branchId}
            error={errors.branchId}
            onChange={(event) => setBranchId(event.target.value)}
            fieldClassName="sm:col-span-3"
          />
        )}
        <Input label="First name" required autoComplete="off" {...field('firstName')} />
        <Input label="Middle name" autoComplete="off" hint="Optional." {...field('middleName')} />
        <Input label="Last name" required autoComplete="off" {...field('lastName')} />
        <Select
          label="Gender"
          required
          options={[
            { value: '', label: 'Choose' },
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
          {...field('gender', { value: values.gender?.toLowerCase() ?? '' })}
        />
        <Input label="Date of birth" type="date" required {...field('dateOfBirth')} />
        <Input label="Phone" type="tel" hint="Optional." {...field('phone')} />
        <Input label="Address" autoComplete="off" hint="Optional." {...field('address')} fieldClassName="sm:col-span-3" />
        <Input label="Guardian name" required autoComplete="off" {...field('guardianName')} />
        <Input label="Guardian phone" type="tel" required placeholder="+252 61 2345678" {...field('guardianPhone')} />
        <Input label="Relationship" autoComplete="off" placeholder="Mother" hint="Optional." {...field('guardianRelationship')} />
        <Input label="Emergency contact" autoComplete="off" hint="Optional." {...field('emergencyContactName')} fieldClassName="sm:col-span-2" />
        <Input label="Emergency phone" type="tel" hint="Optional." {...field('emergencyContactPhone')} />
      </form>
    </Modal>
  );
}

/**
 * Enroll a student (Manager): choose the academic year, then the section directly ("Grade 7A"): the
 * class follows from the section. Only active sections of planned or current years in the branch.
 */
export function EnrollModal({ student, open, onClose, onDone }) {
  const formId = useId();
  const save = useSave(open);
  const years = useApiData(() => (open ? loadAcademicYears('MANAGER') : Promise.resolve(null)), `years|${open}`);
  const writable = (years.data?.items ?? []).filter((y) => y.status !== 'closed');
  const [yearId, setYearId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [problem, setProblem] = useState('');
  const chosenYear = yearId || writable.find((y) => y.status === 'current')?.id || writable[0]?.id || '';
  const sections = useApiData(
    () => (open && chosenYear ? apiRequest('/manager/sections', { query: { academicYear: chosenYear, status: 'active' } }) : Promise.resolve(null)),
    `sections|${open}|${chosenYear}`,
  );
  useEffect(() => {
    if (!open) return;
    setYearId('');
    setSectionId('');
    setProblem('');
  }, [open]);
  const taken = new Set((student?.enrollments ?? []).map((e) => e.academicYear.id));

  const submit = (event) => {
    event.preventDefault();
    if (!sectionId) return setProblem('Choose a section.');
    return save.run(async () => onDone(await enrollStudent(student.id, sectionId)), 'enrollment');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enroll Student"
      description={student && `${student.fullName} · ${student.studentNumber}`}
      loading={save.saving}
      loadingLabel="Enrolling…"
      error={save.error}
      footer={<Footer onClose={onClose} saving={save.saving} formId={formId} label="Enroll" />}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select
          label="Academic year"
          options={writable.length ? writable.map((y) => ({ value: y.id, label: `${y.name}${y.status === 'current' ? ' (current)' : ' (planned)'}${taken.has(y.id) ? ' — already enrolled' : ''}` })) : [{ value: '', label: 'No planned or current year' }]}
          value={chosenYear}
          onChange={(event) => {
            setYearId(event.target.value);
            setSectionId('');
          }}
        />
        <Select
          label="Section"
          required
          options={[{ value: '', label: sections.data?.items?.length ? 'Choose a section' : 'No active sections in this year' }, ...(sections.data?.items ?? []).map((s) => ({ value: s.id, label: `${s.displayName}${s.capacity ? ` (${s.students}/${s.capacity})` : ''}` }))]}
          value={sectionId}
          error={problem}
          hint="The class follows from the section."
          onChange={(event) => {
            setSectionId(event.target.value);
            setProblem('');
          }}
        />
      </form>
    </Modal>
  );
}

/** Change an active enrollment: its section (same academic year) and its year-end result. */
export function EnrollmentModal({ enrollment, open, onClose, onDone }) {
  const formId = useId();
  const save = useSave(open);
  const [sectionId, setSectionId] = useState('');
  const [result, setResult] = useState('');
  const sections = useApiData(
    () => (open && enrollment ? apiRequest('/manager/sections', { query: { academicYear: enrollment.academicYear.id, status: 'active' } }) : Promise.resolve(null)),
    `enrollment-sections|${open}|${enrollment?.id}`,
  );
  useEffect(() => {
    if (!open || !enrollment) return;
    setSectionId(enrollment.section.id);
    setResult(enrollment.result ?? '');
  }, [open, enrollment]);
  const closed = enrollment?.academicYear.status === 'closed';

  const submit = (event) => {
    event.preventDefault();
    const body = {};
    if (sectionId !== enrollment.section.id) body.sectionId = sectionId;
    if ((result || null) !== (enrollment.result ?? null)) body.result = result ? result.toUpperCase() : null;
    if (!Object.keys(body).length) return onDone(enrollment);
    return save.run(async () => onDone(await updateEnrollment(enrollment.id, body)), 'enrollment');
  };
  const options = (sections.data?.items ?? []).map((s) => ({ value: s.id, label: s.displayName }));
  if (enrollment && !options.some((o) => o.value === enrollment.section.id)) options.unshift({ value: enrollment.section.id, label: enrollment.section.displayName });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update Enrollment"
      description={enrollment && `${enrollment.academicYear.name} · ${enrollment.section.displayName}`}
      loading={save.saving}
      loadingLabel="Saving…"
      error={save.error}
      footer={<Footer onClose={onClose} saving={save.saving} formId={formId} label="Save Changes" />}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select
          label="Section"
          options={options}
          value={sectionId}
          disabled={closed}
          hint={closed ? 'The year is closed: the section stays as it is.' : 'A correction within the same academic year.'}
          onChange={(event) => setSectionId(event.target.value)}
        />
        <Select
          label="Year-end result"
          options={[
            { value: '', label: 'Not recorded' },
            { value: 'passed', label: 'Passed' },
            { value: 'failed', label: 'Failed' },
          ]}
          value={result}
          hint="Promotion recommends: passed → next class, failed → repeat, not recorded → review."
          onChange={(event) => setResult(event.target.value)}
        />
      </form>
    </Modal>
  );
}

/** Transfer a student out (Manager): the active enrollment ends; everything is kept. */
export function TransferOutModal({ student, open, onClose, onDone }) {
  const formId = useId();
  const save = useSave(open);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (!open) return;
    setReason('');
    setProblem('');
  }, [open]);
  const submit = (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) return setProblem('Give a reason (at least 3 characters).');
    return save.run(async () => onDone(await transferOut(student.id, reason.trim())), 'student');
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transfer Student Out"
      description={student && `${student.fullName} · ${student.studentNumber}`}
      loading={save.saving}
      loadingLabel="Transferring…"
      error={save.error}
      footer={<Footer onClose={onClose} saving={save.saving} formId={formId} label="Transfer Out" variant="danger" />}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
          The student leaves the school: their current enrollment ends as transferred out and they leave promotion lists. Their profile and history are kept.
        </p>
        <Textarea label="Reason" required rows={3} value={reason} error={problem} onChange={(event) => setReason(event.target.value)} />
      </form>
    </Modal>
  );
}

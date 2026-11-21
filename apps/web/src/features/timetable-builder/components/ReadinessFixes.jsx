import { useId, useState } from 'react';
import { BellRing, CalendarDays, ListChecks, UserPlus } from 'lucide-react';
import { Alert, Button, ErrorState, Modal, RadioGroup, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { WeekdaysModal } from '../../academic-calendar/components/CalendarModals.jsx';
import { loadCalendar } from '../../academic-calendar/data/calendarApi.js';
import { earliestWeekdaysDate } from '../../academic-calendar/utils/calendarRules.js';
import { AssignModal, CurriculumModal } from '../../teaching/components/TeachingModals.jsx';
import { loadCurriculum, loadSectionTeaching, loadSubjects } from '../../teaching/data/teachingApi.js';
import { BellTimesModal } from '../../timetable/components/BellModals.jsx';
import { loadBellSchedule } from '../../timetable/data/timetableApi.js';
import { saveSetup } from '../data/builderApi.js';
import { bellPeriods, fixActions } from '../utils/builderRules.js';

const LABELS = {
  'bell-choice': { label: 'Choose bell schedule', icon: BellRing },
  'bell-times': { label: 'Change bell times', icon: BellRing },
  lessons: { label: 'Edit lessons per week', icon: ListChecks },
  'school-days': { label: 'Change school days', icon: CalendarDays },
  assign: { label: 'Assign teacher', icon: UserPlus },
};

/**
 * Buttons that fix a readiness item right here (the same forms as on their own pages, with the same
 * checks): choose the class's bell schedule, change bell times, edit lessons per week (one list
 * for the class in every branch), change school days, assign a teacher. `onChanged(message)` reloads the checks.
 * Returns null when the item has no fix of this kind.
 */
export function ReadinessFixes({ item, role, context, builder, weekdays, onChanged }) {
  const [open, setOpen] = useState(null);
  const actions = fixActions(item);
  if (!actions.length || !builder) return null;
  const section = builder.sections.find((s) => s.id === item.sectionId) ?? null;
  const reason = (a) => {
    if ((a === 'bell-times' || a === 'bell-choice') && !section && item.sectionId) return 'The class is not in this branch’s list.';
    if (a === 'bell-times' && !section?.bell) return 'The class has no bell schedule yet: choose one first.';
    return undefined;
  };
  const done = (message) => {
    setOpen(null);
    onChanged(message);
  };
  const classId = item.classId ?? section?.class.id;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => {
        const { label, icon } = LABELS[a];
        return (
          <Button key={a} size="sm" variant="outline" leftIcon={icon} onClick={() => setOpen(a)} unavailableReason={reason(a)}>
            {label}
          </Button>
        );
      })}
      {open === 'bell-choice' && <BellChoiceModal role={role} context={context} builder={builder} section={section} weekdays={weekdays} onClose={() => setOpen(null)} onSaved={done} />}
      {open === 'bell-times' && section?.bell && <BellTimesFix role={role} bellId={section.bell.id} onClose={() => setOpen(null)} onSaved={done} />}
      {open === 'lessons' && classId && <LessonsFix role={role} classId={classId} onClose={() => setOpen(null)} onSaved={done} />}
      {open === 'school-days' && <SchoolDaysFix role={role} yearId={builder.academicYear.id} branchName={builder.branch.name} onClose={() => setOpen(null)} onSaved={done} />}
      {open === 'assign' && <AssignFix role={role} sectionId={item.sectionId} subjectId={item.subjectId} onClose={() => setOpen(null)} onSaved={done} />}
    </div>
  );
}

/** Which bell schedule a class (or every class of the branch) uses for the timetable. */
function BellChoiceModal({ role, context, builder, section, weekdays, onClose, onSaved }) {
  const formId = useId();
  const usable = builder.bellSchedules.filter((b) => b.status === 'active' && b.hasTimes);
  const form = useDialogForm(true, { bell: section?.bell?.id ?? usable[0]?.id ?? '', scope: section ? 'class' : 'all' }, requestFailure);
  const v = form.values;
  const classes = builder.sections.filter((s) => !s.excluded);
  const save = () => {
    const problems = v.bell ? {} : { bell: 'Choose a bell schedule.' };
    const targets = v.scope === 'class' && section ? [section] : classes;
    return form.submit(problems, ['bell'], () => saveSetup(role, context, { sectionBells: Object.fromEntries(targets.map((s) => [s.id, v.bell])) }), () =>
      onSaved(`${usable.find((b) => b.id === v.bell)?.name} is now used by ${targets.length === 1 ? targets[0].displayName : `all ${targets.length} classes`}.`),
    );
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Choose Bell Schedule"
      description={`The lesson periods the timetable uses. Periods a week are counted on the school days (${weekdays.length} days).`}
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={form.saving}>
            Use This Bell Schedule
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        {!usable.length && <Alert variant="warning">No active bell schedule has times. Make one in Bell Schedules first.</Alert>}
        <RadioGroup
          legend="Bell schedule"
          value={v.bell}
          onChange={(value) => form.set('bell', value)}
          options={usable.map((b) => {
            const periods = bellPeriods(b, weekdays);
            const need = section?.lessonsNeeded;
            return {
              value: b.id,
              label: `${b.name}${b.level === 'school' ? ' (school-wide)' : ''}`,
              description: `${periods} lesson periods a week${need ? ` · ${section.displayName} needs ${need}${periods === need ? ' ✓ fits' : periods < need ? ` (${need - periods} short)` : ` (${periods - need} more)`}` : ''}`,
            };
          })}
        />
        {form.errors.bell && <p className="text-small text-error-fg">{form.errors.bell}</p>}
        <RadioGroup
          legend="Use it for"
          value={v.scope}
          onChange={(value) => form.set('scope', value)}
          options={[
            ...(section ? [{ value: 'class', label: `Only ${section.displayName}` }] : []),
            { value: 'all', label: `Every class of ${builder.branch.name} (${classes.length})` },
          ]}
        />
        <p className="text-small text-fg-muted">Saved in the builder’s Rules. Published timetables do not change until you generate and publish again.</p>
      </form>
    </Modal>
  );
}

function Loading({ data, onClose }) {
  if (data.status === 'error') {
    return (
      <Modal open onClose={onClose} title="Could not load">
        <ErrorState title="The form could not be loaded" description={data.error?.message} onRetry={data.retry} />
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title="Loading…">
      <Skeleton className="h-40" />
    </Modal>
  );
}

/** The class's bell schedule times (the Bell Schedules form). */
function BellTimesFix({ role, bellId, onClose, onSaved }) {
  const detail = useApiData(() => loadBellSchedule(role, bellId), `fix-bell|${bellId}`);
  if (!detail.data) return <Loading data={detail} onClose={onClose} />;
  const bell = detail.data.bellSchedule;
  if (!bell.canManage) {
    return (
      <Modal open onClose={onClose} title={bell.name}>
        <Alert variant="info">This is a school-wide bell schedule: your School Owner changes its times. You can choose another bell schedule for the class instead.</Alert>
      </Modal>
    );
  }
  return (
    <BellTimesModal
      role={role}
      bell={bell}
      start={[...bell.versions].reverse().find((v) => v.state !== 'cancelled' && v.state !== 'past') ?? bell.current}
      earliest={detail.data.firstEditableDate}
      open
      onClose={onClose}
      onSaved={() => onSaved(`Times of ${bell.name} saved.`)}
    />
  );
}

/** The class's subjects and lessons per week (the class page's form; School Owner). */
function LessonsFix({ role, classId, onClose, onSaved }) {
  const curriculum = useApiData(() => loadCurriculum(role, classId), `fix-cur|${classId}`);
  const subjects = useApiData(() => loadSubjects(role, {}), 'fix-subjects');
  if (!curriculum.data || !subjects.data) return <Loading data={curriculum.data ? subjects : curriculum} onClose={onClose} />;
  return <CurriculumModal role={role} cls={curriculum.data.class} curriculum={curriculum.data} subjects={subjects.data.items} open onClose={onClose} onSaved={() => onSaved(`${curriculum.data.class.name}’s subjects were saved.`)} />;
}

/** School days (the Academic Calendar's form): the school's (Owner) or the branch's (Manager, when allowed). */
function SchoolDaysFix({ role, yearId, branchName, onClose, onSaved }) {
  const cal = useApiData(() => loadCalendar(role, yearId), `fix-cal|${yearId}`);
  if (!cal.data) return <Loading data={cal} onClose={onClose} />;
  const data = cal.data;
  const manager = role === 'MANAGER';
  if (manager && !data.branchWeekdaysAllowed) {
    return (
      <Modal open onClose={onClose} title="School days">
        <Alert variant="info">Your School Owner sets the school days for {data.academicYear.name}; branches cannot set their own this year. Ask them, or choose a bell schedule with more periods.</Alert>
      </Modal>
    );
  }
  const own = manager ? (data.weekdays.branches[0]?.versions ?? []) : data.weekdays.school.versions;
  const inEffect = (versions) => versions.some((v) => v.state !== 'cancelled' && v.effectiveFrom <= data.today);
  const appliesToday = manager ? inEffect(own) || inEffect(data.weekdays.school.versions) : inEffect(own);
  const limits = { earliest: earliestWeekdaysDate({ today: data.today, yearStart: data.academicYear.startDate, appliesToday, delayDays: data.schoolDaysDelayDays }), yearStart: data.academicYear.startDate, yearEnd: data.academicYear.endDate };
  return (
    <WeekdaysModal
      role={role}
      year={data.academicYear}
      branchName={data.weekdays.branches[0]?.branch.name ?? branchName}
      current={manager ? (data.weekdays.branches[0]?.days ?? data.weekdays.school.days ?? []) : (data.weekdays.school.days ?? [])}
      schoolDays={data.weekdays.school.days ?? []}
      limits={limits}
      open
      onClose={onClose}
      onSaved={() => onSaved('School days were saved.')}
    />
  );
}

/** A teacher for the subject of the section (the Teaching page's form). */
function AssignFix({ role, sectionId, subjectId, onClose, onSaved }) {
  const view = useApiData(() => loadSectionTeaching(role, sectionId), `fix-teach|${sectionId}`);
  if (!view.data) return <Loading data={view} onClose={onClose} />;
  const d = view.data;
  const context = {
    role,
    section: d.section,
    subjects: d.subjects.filter((s) => s.subject.status === 'active' && !s.offList).map((s) => s.subject),
    earliest: d.firstEditableDate > d.section.academicYear.startDate ? d.firstEditableDate : d.section.academicYear.startDate,
    yearEnd: d.section.academicYear.endDate,
    ...(subjectId && { fixedSubject: subjectId }),
  };
  return <AssignModal context={context} open onClose={onClose} onSaved={(a) => onSaved(`${a.teacher?.name ?? 'The teacher'} now teaches ${a.subject?.name ?? 'the subject'} in ${d.section.displayName}.`)} />;
}

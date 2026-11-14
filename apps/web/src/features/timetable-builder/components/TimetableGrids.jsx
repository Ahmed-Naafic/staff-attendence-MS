import { Lock, Pin } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { classRows, DAY_NAMES, DAY_SHORT, lessonAt, masterColumns, subjectHues, subjectStyle, teacherCells } from '../utils/builderRules.js';

/*
 * Weekly timetable grids, shared by the builder's draft review and the timetable views. Cells are
 * buttons only when `onCell` is given (draft editing); the text always says what is there, colour
 * only helps. Each grid scrolls sideways on narrow screens.
 */

function LessonCell({ lesson, hue, extra, selected, target, onClick, label }) {
  const content = lesson ? (
    <span className="flex flex-col items-center gap-0.5 text-center">
      <span className="flex items-center gap-1 font-medium text-fg">
        {lesson.fixed && <Pin aria-label="Fixed" className="size-3" />}
        {!lesson.fixed && lesson.locked && <Lock aria-label="Locked" className="size-3" />}
        {lesson.subject?.code || lesson.subject?.name}
      </span>
      {lesson.teacher && <span className="text-caption text-fg-secondary">{lesson.teacher.name}</span>}
      {extra}
    </span>
  ) : (
    <span className="text-caption text-fg-muted">{target ? 'Place here' : '—'}</span>
  );
  const cls = cn(
    'min-h-14 w-full rounded-sm px-1.5 py-1 text-small',
    !lesson && 'bg-surface',
    selected && 'ring-2 ring-interactive',
    target && !lesson && 'outline outline-1 outline-dashed outline-interactive',
  );
  const style = lesson ? subjectStyle(hue) : undefined;
  if (!onClick) return <div className={cls} style={style}>{content}</div>;
  return (
    <button type="button" className={cn(cls, 'cursor-pointer hover:opacity-90 focus-visible:outline-2')} style={style} onClick={onClick} aria-pressed={selected || undefined} aria-label={label}>
      {content}
    </button>
  );
}

/** One class's week: periods (rows) × days. */
export function ClassGrid({ caption, days, periods, lessons, selected, targetable, onCell, hues }) {
  const rows = classRows(periods, days);
  const colours = hues ?? subjectHues(lessons);
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto focus-visible:outline-offset-[-2px]">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-small">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-24 px-2 py-1 text-left font-semibold text-fg-secondary">Period</th>
            {days.map((d) => (
              <th key={d} scope="col" className="px-2 py-1 font-semibold text-fg-secondary">
                {DAY_NAMES[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.number}>
              <th scope="row" className="px-2 py-1 text-left align-middle font-normal">
                <span className="block font-medium text-fg">P{r.number}</span>
                <span className="text-caption text-fg-muted">
                  {r.start}–{r.end}
                </span>
              </th>
              {days.map((d) => {
                if (!r.days.has(d)) return <td key={d} className="rounded-sm bg-muted/40" aria-label="No period" />;
                const lesson = lessonAt(lessons, d, r.number);
                const isSel = selected && selected.weekday === d && selected.period === r.number;
                return (
                  <td key={d} className="align-top">
                    <LessonCell
                      lesson={lesson}
                      hue={lesson ? colours.get(lesson.subject?.id) : undefined}
                      selected={isSel}
                      target={targetable}
                      onClick={onCell ? () => onCell({ weekday: d, period: r.number, lesson }) : undefined}
                      label={`${DAY_NAMES[d]} period ${r.number}: ${lesson ? `${lesson.subject?.name}${lesson.teacher ? `, ${lesson.teacher.name}` : ''}` : 'free'}`}
                    />
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

/** A teacher's week: clock times (rows) × days, every class and branch they teach. */
export function TeacherGrid({ view }) {
  const cells = teacherCells(view);
  const colours = subjectHues(view.lessons);
  return (
    <div role="region" aria-label={`Timetable of ${view.teacher.name}`} tabIndex={0} className="overflow-x-auto focus-visible:outline-offset-[-2px]">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-small">
        <caption className="sr-only">{`Timetable of ${view.teacher.name}`}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-24 px-2 py-1 text-left font-semibold text-fg-secondary">Time</th>
            {view.days.map((d) => (
              <th key={d} scope="col" className="px-2 py-1 font-semibold text-fg-secondary">
                {DAY_NAMES[d]} <span className="font-normal text-fg-muted">({view.perDay[d] ?? 0})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={`${r.start}-${r.end}`}>
              <th scope="row" className="px-2 py-1 text-left font-medium text-fg">
                {r.start}–{r.end}
              </th>
              {view.days.map((d) => {
                const list = cells.get(`${d}|${r.start}`) ?? [];
                return (
                  <td key={d} className="align-top">
                    {list.length ? (
                      list.map((l) => (
                        <div key={`${l.section.id}-${l.period}`} className={cn('mb-1 min-h-14 rounded-sm px-1.5 py-1 text-center', l.elsewhere && 'bg-muted')} style={l.elsewhere ? undefined : subjectStyle(colours.get(l.subject?.id))}>
                          <span className="block font-medium text-fg">{l.section.displayName}</span>
                          <span className="block text-caption text-fg-secondary">
                            {l.subject?.name}
                            {l.elsewhere ? ` · ${l.section.branch.name}` : ''}
                          </span>
                          {l.room && <span className="block text-caption text-fg-muted">Room {l.room}</span>}
                        </div>
                      ))
                    ) : (
                      <div className="min-h-14 rounded-sm bg-surface px-1.5 py-1 text-center text-caption text-fg-muted">Free</div>
                    )}
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

/** The branch on one day: classes (rows) × periods. */
export function MasterGrid({ sections, day, selected, placing, onCell, hues }) {
  const columns = masterColumns(sections, day);
  const colours = hues ?? subjectHues(sections.flatMap((s) => s.lessons ?? []));
  return (
    <div role="region" aria-label={`Master timetable, ${DAY_NAMES[day]}`} tabIndex={0} className="overflow-x-auto focus-visible:outline-offset-[-2px]">
      <table className="w-full border-separate border-spacing-1 text-small" style={{ minWidth: `${140 + columns.length * 110}px` }}>
        <caption className="sr-only">{`Master timetable, ${DAY_NAMES[day]}`}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-32 px-2 py-1 text-left font-semibold text-fg-secondary">Class</th>
            {columns.map((n) => {
              const p = sections.flatMap((s) => s.periods[day] ?? []).find((x) => x.number === n);
              return (
                <th key={n} scope="col" className="px-2 py-1 font-semibold text-fg-secondary">
                  P{n}
                  {p && <span className="block text-caption font-normal text-fg-muted">{p.start}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <tr key={s.id}>
              <th scope="row" className="px-2 py-1 text-left font-medium text-fg">
                {s.displayName}
              </th>
              {columns.map((n) => {
                const has = (s.periods[day] ?? []).some((p) => p.number === n && (!p.kind || p.kind === 'lesson'));
                if (!has) return <td key={n} className="rounded-sm bg-muted/40" aria-label="No period" />;
                const lesson = lessonAt(s.lessons ?? [], day, n);
                const isSel = selected && selected.sectionId === s.id && selected.weekday === day && selected.period === n;
                const target = Boolean(placing && placing.sectionId === s.id);
                return (
                  <td key={n} className="align-top">
                    <LessonCell
                      lesson={lesson}
                      hue={lesson ? colours.get(lesson.subject?.id) : undefined}
                      selected={isSel}
                      target={target}
                      onClick={onCell ? () => onCell({ sectionId: s.id, weekday: day, period: n, lesson }) : undefined}
                      label={`${s.displayName}, ${DAY_SHORT[day]} period ${n}: ${lesson ? `${lesson.subject?.name}${lesson.teacher ? `, ${lesson.teacher.name}` : ''}` : 'free'}`}
                    />
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

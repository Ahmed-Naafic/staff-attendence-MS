/*
 * Teachers' lesson marks on the phone: stored before upload with the time taken, grouped per lesson,
 * the server's answer per mark decides recorded/refused, whole-lesson refusals are final, no
 * answer or a wrong phone clock keeps them waiting; and the screen rules.
 */
import { ApiError } from '../../api/client';
import { migrate } from '../../db/database';
import { countPendingMarks, enqueueMarks, groupByLesson, lessonOutstanding, outstandingMarks, pendingMarks } from '../lessonQueue';
import { allPresent, changedMarks, countText, lessonState, withPhoneMarks } from '../lessonRules';
import { isFinalLessonRefusal, syncLessonMarks } from '../lessonSync';

const USER = 'teacher-1';
const A = { sectionId: 'sec-a', date: '2026-11-13', period: 1 };
const B = { sectionId: 'sec-b', date: '2026-11-13', period: 2 };

async function freshDb() {
  const db = global.__openTestDatabase();
  await migrate(db);
  return db;
}

function fakeApi(...answers) {
  const calls = [];
  return {
    calls,
    request: jest.fn(async (path, options) => {
      calls.push({ path, body: options?.body });
      const answer = answers.shift();
      if (!answer) throw new Error('unexpected request');
      return answer(options?.body);
    }),
  };
}
const recordedAll = (body) => ({ status: 200, data: { results: body.marks.map((m) => ({ student: m.student, result: 'recorded' })), lesson: null } });

describe('queue and upload', () => {
  test('marks are stored with the time taken and uploaded once per lesson, oldest lesson first', async () => {
    const db = await freshDb();
    await enqueueMarks(db, USER, B, [{ clientMarkId: 'm3', studentId: 's3', status: 'present' }], new Date('2026-11-13T09:00:00Z'));
    await enqueueMarks(db, USER, A, [{ clientMarkId: 'm1', studentId: 's1', status: 'present' }, { clientMarkId: 'm2', studentId: 's2', status: 'absent' }], new Date('2026-11-13T07:00:00Z'));
    expect(await countPendingMarks(db, USER)).toBe(3);
    expect(groupByLesson(await pendingMarks(db, USER)).map((g) => [g.sectionId, g.marks.length])).toEqual([['sec-a', 2], ['sec-b', 1]]);

    const api = fakeApi(recordedAll, recordedAll);
    const result = await syncLessonMarks({ db, api, userId: USER, clock: () => new Date('2026-11-13T10:00:00Z') });
    expect(result).toEqual({ recorded: 3, rejected: 0, stoppedBy: null });
    expect(api.calls.map((c) => c.path)).toEqual(['/api/teacher/lessons/marks', '/api/teacher/lessons/marks']);
    expect(api.calls[0].body).toEqual({
      section: 'sec-a',
      date: '2026-11-13',
      period: 1,
      sentAt: '2026-11-13T10:00:00.000Z',
      marks: [
        { student: 's1', status: 'present', occurredAt: '2026-11-13T07:00:00.000Z' },
        { student: 's2', status: 'absent', occurredAt: '2026-11-13T07:00:00.000Z' },
      ],
    });
    expect(await countPendingMarks(db, USER)).toBe(0);
    // Nothing waiting: nothing sent.
    const idle = fakeApi();
    await syncLessonMarks({ db, api: idle, userId: USER });
    expect(idle.calls).toHaveLength(0);
  });

  test('per-mark refusals are final; no answer or a wrong clock keeps marks waiting', async () => {
    const db = await freshDb();
    await enqueueMarks(db, USER, A, [{ clientMarkId: 'm1', studentId: 's1', status: 'present' }, { clientMarkId: 'm2', studentId: 's2', status: 'absent' }]);
    await enqueueMarks(db, USER, B, [{ clientMarkId: 'm3', studentId: 's3', status: 'present' }]);
    const offline = fakeApi(() => {
      throw new ApiError({ kind: 'network', message: 'No connection' });
    });
    const first = await syncLessonMarks({ db, api: offline, userId: USER });
    expect(first.stoppedBy.kind).toBe('network');
    expect(offline.calls).toHaveLength(1);
    expect(await countPendingMarks(db, USER)).toBe(3);

    const skew = fakeApi(() => {
      throw new ApiError({ kind: 'http', status: 422, code: 'CLOCK_SKEW', message: 'Clock' });
    });
    await syncLessonMarks({ db, api: skew, userId: USER });
    expect(await countPendingMarks(db, USER)).toBe(3);

    const answers = fakeApi(
      () => ({ status: 200, data: { results: [{ student: 's1', result: 'recorded' }, { student: 's2', result: 'refused', code: 'SET_BY_MANAGER', message: 'A Manager has set this.' }] } }),
      () => {
        throw new ApiError({ kind: 'http', status: 409, code: 'UPLOAD_PERIOD_OVER', message: 'Too late.' });
      },
    );
    const done = await syncLessonMarks({ db, api: answers, userId: USER });
    expect(done).toEqual({ recorded: 1, rejected: 2, stoppedBy: null });
    const left = await outstandingMarks(db, USER);
    expect(left.map((m) => [m.clientMarkId, m.state, m.errorCode]).sort()).toEqual([
      ['m2', 'rejected', 'SET_BY_MANAGER'],
      ['m3', 'rejected', 'UPLOAD_PERIOD_OVER'],
    ]);
    expect((await lessonOutstanding(db, USER, A)).map((m) => m.clientMarkId)).toEqual(['m2']);
  });

  test('which failures are final', () => {
    expect(isFinalLessonRefusal(new ApiError({ kind: 'http', status: 404, message: 'x' }))).toBe(true);
    expect(isFinalLessonRefusal(new ApiError({ kind: 'http', status: 403, code: 'FEATURE_DISABLED', message: 'x' }))).toBe(true);
    expect(isFinalLessonRefusal(new ApiError({ kind: 'http', status: 422, code: 'CLOCK_SKEW', message: 'x' }))).toBe(false);
    expect(isFinalLessonRefusal(new ApiError({ kind: 'http', status: 401, message: 'x' }))).toBe(false);
    expect(isFinalLessonRefusal(new ApiError({ kind: 'http', status: 503, message: 'x' }))).toBe(false);
    expect(isFinalLessonRefusal(new ApiError({ kind: 'timeout', message: 'x' }))).toBe(false);
  });
});

describe('screen rules', () => {
  const students = [
    { id: 's1', status: null, setByManager: false },
    { id: 's2', status: 'absent', setByManager: false },
    { id: 's3', status: 'late', setByManager: true },
  ];

  test('the phone’s marks show over the server’s; refused ones are reported', () => {
    const shown = withPhoneMarks(students, [
      { studentId: 's1', state: 'pending', status: 'present' },
      { studentId: 's2', state: 'rejected', status: 'present', errorMessage: 'Too late.' },
    ]);
    expect(shown.map((s) => [s.id, s.status, s.waiting, s.refused])).toEqual([
      ['s1', 'present', true, null],
      ['s2', 'absent', false, 'Too late.'],
      ['s3', 'late', false, null],
    ]);
  });

  test('all present fills the unmarked only; only real changes are stored; Manager marks are left alone', () => {
    const draft = allPresent(students, {});
    expect(draft).toEqual({ s1: 'present' });
    expect(changedMarks(students, { ...draft, s2: 'absent', s3: 'present' })).toEqual([{ studentId: 's1', status: 'present' }]);
    expect(countText(students, draft)).toBe('1 present · 1 absent · 1 other');
  });

  test('the lesson state follows the phone clock', () => {
    const lesson = { opensAt: '2026-11-13T07:00:00Z', deadlineAt: '2026-11-13T08:00:00Z' };
    expect(lessonState(lesson, new Date('2026-11-13T06:59:00Z'))).toBe('upcoming');
    expect(lessonState(lesson, new Date('2026-11-13T07:30:00Z'))).toBe('open');
    expect(lessonState(lesson, new Date('2026-11-13T08:01:00Z'))).toBe('closed');
  });
});

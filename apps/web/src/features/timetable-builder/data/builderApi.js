import { apiDownload, apiRequest } from '../../../lib/api.js';

/*
 * Timetable builder and timetable views. A Manager's branch is decided by the server; the School
 * Owner names it. Writes throw ApiError: 400 VALIDATION_ERROR (details per field), 403 FORBIDDEN
 * (another branch's teacher), 404 NOT_FOUND, 409 NOT_READY (details.blockers) / DRAFT_CONFLICT
 * (details.conflicts) / STALE_DRAFT / DRAFT_CLOSED / FIXED_LESSON / FIXED_EXISTS / PERIOD_TAKEN /
 * SUBJECT_COMPLETE / TEACHER_CLASH / PUBLISH_REFUSED / YEAR_CLOSED / BRANCH_NOT_OPERATING.
 */
const base = (role) => (role === 'OWNER' ? '/owner' : '/manager');
const id = (value) => encodeURIComponent(value);
const ctx = (role, { academicYear, branch, date } = {}) => ({ academicYear: academicYear || undefined, branch: role === 'OWNER' ? branch || undefined : undefined, date: date || undefined });
const B = (role) => `${base(role)}/timetable-builder`;

/** { today, planDate, academicYear, branch, setup, bellSchedules, sections, subjects, fixedLessons, readiness, draft } */
export const loadBuilder = (role, context) => apiRequest(B(role), { query: ctx(role, context) });
/** { ready, planDate, blockers, warnings, summary, teachers } */
export const loadReadiness = (role, context) => apiRequest(`${B(role)}/readiness`, { query: ctx(role, context) });
export const saveSetup = (role, context, changes) => apiRequest(`${B(role)}/setup`, { method: 'PUT', body: { ...ctx(role, context), date: undefined, ...changes } });
/** { planDate, defaultMaxPerDay, items: [{ id, name, staffId, homeBranch, lessons, capacity, maxPerDay, maxPerWeek, unavailable, busyElsewhere, canEdit }] } */
export const loadBuilderTeachers = (role, context) => apiRequest(`${B(role)}/teachers`, { query: ctx(role, context) });
export const saveTeacherLimits = (role, teacherId, body) => apiRequest(`${B(role)}/teachers/${id(teacherId)}`, { method: 'PUT', body });
export const addFixedLesson = (role, context, body) => apiRequest(`${B(role)}/fixed-lessons`, { method: 'POST', body: { ...ctx(role, context), date: undefined, ...body } });
export const removeFixedLesson = (role, fixedId) => apiRequest(`${B(role)}/fixed-lessons/${id(fixedId)}`, { method: 'DELETE' });
/** → { draft } */
export const generateTimetable = (role, context, { keepLocked = true } = {}) => apiRequest(`${B(role)}/generate`, { method: 'POST', body: { ...ctx(role, context), keepLocked } });
export const loadDraft = (role, context) => apiRequest(`${B(role)}/draft`, { query: ctx(role, context) });
/** body: { revision, action: 'move' | 'lock' | 'unlock' | 'remove' | 'place' | 'teacher', … } → { draft } */
export const editDraft = (role, draftId, body) => apiRequest(`${B(role)}/drafts/${id(draftId)}/edit`, { method: 'POST', body });
/** → { published, effectiveFrom, changed, unchanged, warnings } */
export const publishDraft = (role, draftId, body) => apiRequest(`${B(role)}/drafts/${id(draftId)}/publish`, { method: 'POST', body });
export const discardDraft = (role, draftId, revision) => apiRequest(`${B(role)}/drafts/${id(draftId)}/discard`, { method: 'POST', body: { revision } });

// ---- views ----
const viewQuery = (role, { academicYear, branch, date, source } = {}) => ({ ...ctx(role, { academicYear, branch, date }), source: source || undefined });
const viewPath = (role, kind, targetId) => `${base(role)}/timetable-views/${kind === 'master' ? 'master' : `${kind === 'section' ? 'sections' : 'teachers'}/${id(targetId)}`}`;
export const loadMasterView = (role, query) => apiRequest(viewPath(role, 'master'), { query: viewQuery(role, query) });
export const loadSectionView = (role, sectionId, query) => apiRequest(viewPath(role, 'section', sectionId), { query: viewQuery(role, query) });
export const loadTeacherView = (role, teacherId, query) => apiRequest(viewPath(role, 'teacher', teacherId), { query: viewQuery(role, query) });
/** { blob, filename } of a view as 'xlsx' or 'pdf'. */
export const downloadView = (role, kind, targetId, query, format) => apiDownload(`${viewPath(role, kind, targetId)}/export.${format}`, { query: viewQuery(role, query) });

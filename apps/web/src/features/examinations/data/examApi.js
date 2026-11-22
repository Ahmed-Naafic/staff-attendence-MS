import { apiDownload, apiRequest } from '../../../lib/api.js';

/*
 * Examinations (docs/business-rules.md → Examinations). The school, and a Manager's branch, are decided
 * by the server from the account. Errors: 400 VALIDATION_ERROR (details per field), 403 FEATURE_DISABLED
 * (Examinations not switched on), 403 FORBIDDEN / SETTING_LOCKED, 404 NOT_FOUND, 409 NAME_TAKEN /
 * PERIOD_OVERLAP / YEAR_CLOSED / DEFAULT_REQUIRED / SCALE_IN_USE / SCALE_INACTIVE.
 */
const base = (role) => `${role === 'OWNER' ? '/owner' : '/manager'}/exams`;
const id = (value) => encodeURIComponent(value);
const owner = (role, value) => (role === 'OWNER' ? value || undefined : undefined);

/** { featureEnabled, academicYear, counts, setup: [{ key, label, done, note, page }] } */
export const loadExamOverview = (role) => apiRequest(`${base(role)}/overview`);

// ---- settings ----
export const loadExamSettings = (role) => apiRequest(`${base(role)}/settings`);
export const saveExamSettings = (role, body) => apiRequest(`${base(role)}/settings`, { method: 'PUT', body });

// ---- academic periods ----
export const loadPeriods = (role, { academicYear, status } = {}) => apiRequest(`${base(role)}/periods`, { query: { academicYear, status } });
export const createPeriod = async (role, body) => (await apiRequest(`${base(role)}/periods`, { method: 'POST', body })).period;
export const updatePeriod = async (role, periodId, body) => (await apiRequest(`${base(role)}/periods/${id(periodId)}`, { method: 'PATCH', body })).period;
export const setPeriodActive = async (role, periodId, active) => (await apiRequest(`${base(role)}/periods/${id(periodId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).period;

// ---- examination types ----
export const loadExamTypes = (role, { status } = {}) => apiRequest(`${base(role)}/types`, { query: { status } });
export const createExamType = async (role, body) => (await apiRequest(`${base(role)}/types`, { method: 'POST', body })).type;
export const updateExamType = async (role, typeId, body) => (await apiRequest(`${base(role)}/types/${id(typeId)}`, { method: 'PATCH', body })).type;
export const setExamTypeActive = async (role, typeId, active) => (await apiRequest(`${base(role)}/types/${id(typeId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).type;

// ---- grading scales ----
export const loadScales = (role, { status } = {}) => apiRequest(`${base(role)}/grading-scales`, { query: { status } });
export const createScale = async (role, body) => (await apiRequest(`${base(role)}/grading-scales`, { method: 'POST', body })).scale;
export const updateScale = async (role, scaleId, body) => (await apiRequest(`${base(role)}/grading-scales/${id(scaleId)}`, { method: 'PATCH', body })).scale;
export const setScaleActive = async (role, scaleId, active) => (await apiRequest(`${base(role)}/grading-scales/${id(scaleId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).scale;

// ---- result formula ----
export const loadFormula = (role, { academicYear } = {}) => apiRequest(`${base(role)}/formula`, { query: { academicYear } });
export const saveFormula = (role, academicYear, body) => apiRequest(`${base(role)}/formula`, { method: 'PUT', body, query: { academicYear } });

// ---- rooms (no location) ----
export const loadRooms = (role, { status, branch, q } = {}) => apiRequest(`${base(role)}/rooms`, { query: { status, branch: owner(role, branch), q: q || undefined } });
export const createRoom = async (role, body) => (await apiRequest(`${base(role)}/rooms`, { method: 'POST', body })).room;
export const updateRoom = async (role, roomId, body) => (await apiRequest(`${base(role)}/rooms/${id(roomId)}`, { method: 'PATCH', body })).room;
export const setRoomActive = async (role, roomId, active) => (await apiRequest(`${base(role)}/rooms/${id(roomId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).room;

// ---- examinations ----
// Errors also: 409 EXAM_OVERLAP / EXAM_STARTED / EXAM_CANCELLED / NO_PAPERS / NO_CLASSES / LAST_PAPER /
// PAPER_EXISTS / NOT_A_DRAFT / NOT_SCHEDULED / EXAM_IN_PAST / EXAM_NOT_RUNNING / TYPE_INACTIVE / NO_CURRENT_YEAR.

/** { academicYear, today, canCreate, counts: { draft, planned, active, completed, cancelled }, items } */
export const loadExaminations = (role, { academicYear, period, scope, branch, state, q } = {}) =>
  apiRequest(`${base(role)}/examinations`, { query: { academicYear, period: period || undefined, scope: scope && scope !== 'all' ? scope : undefined, branch: owner(role, branch), state: state && state !== 'all' ? state : undefined, q: q || undefined } });
/** { academicYear, today, periods, types, classes, subjects, branches, limits: { maxMarks, paperMinutes } } */
export const loadExaminationOptions = (role, { academicYear } = {}) => apiRequest(`${base(role)}/examinations/options`, { query: { academicYear } });
/** { examination, countsFor, classes: [{ id, name, sections, students, papers: [...] }] } (every write returns the same). */
export const loadExamination = (role, examId) => apiRequest(`${base(role)}/examinations/${id(examId)}`);
export const createExamination = (role, body) => apiRequest(`${base(role)}/examinations`, { method: 'POST', body });
export const updateExamination = (role, examId, body) => apiRequest(`${base(role)}/examinations/${id(examId)}`, { method: 'PATCH', body });
export const scheduleExamination = (role, examId) => apiRequest(`${base(role)}/examinations/${id(examId)}/schedule`, { method: 'POST' });
export const unscheduleExamination = (role, examId) => apiRequest(`${base(role)}/examinations/${id(examId)}/unschedule`, { method: 'POST' });
export const cancelExamination = (role, examId, reason) => apiRequest(`${base(role)}/examinations/${id(examId)}/cancel`, { method: 'POST', body: { reason: reason || null } });
export const endExamination = (role, examId, reason) => apiRequest(`${base(role)}/examinations/${id(examId)}/end`, { method: 'POST', body: { reason: reason || null } });
export const addPaper = (role, examId, body) => apiRequest(`${base(role)}/examinations/${id(examId)}/papers`, { method: 'POST', body });
export const updatePaper = (role, examId, paperId, body) => apiRequest(`${base(role)}/examinations/${id(examId)}/papers/${id(paperId)}`, { method: 'PATCH', body });
export const removePaper = (role, examId, paperId) => apiRequest(`${base(role)}/examinations/${id(examId)}/papers/${id(paperId)}`, { method: 'DELETE' });

// ---- timetable (per branch: the School Owner names it; a Manager's is theirs) ----
// Errors also: 409 EXAM_STARTED / NO_EXAM_DAYS / NOT_ENOUGH_SEATS / SESSION_OVERLAP / CLASS_BUSY / TOO_MANY_PAPERS /
// SESSION_PAST / STAFF_BUSY / NOT_SCHEDULED / PAPERS_NOT_TIMETABLED / ROOMS_WITHOUT_INVIGILATOR / NOT_A_SCHOOL_DAY.
const tt = (role, examId, path = '') => `${base(role)}/examinations/${id(examId)}/timetable${path}`;
const tq = (role, branch) => ({ branch: owner(role, branch) });
/** { examination, branch, branches, today, timetable, settings, actions, sessions, unscheduled, staffLoad, summary } */
export const loadTimetable = (role, examId, branch) => apiRequest(tt(role, examId), { query: tq(role, branch) });
/** { branch, rooms, staff, days, students, largestClass, defaults, settings } */
export const loadTimetableOptions = (role, examId, branch) => apiRequest(tt(role, examId, '/options'), { query: tq(role, branch) });
export const generateTimetable = (role, examId, branch, body) => apiRequest(tt(role, examId, '/generate'), { method: 'POST', body, query: tq(role, branch) });
export const clearTimetable = (role, examId, branch) => apiRequest(tt(role, examId, '/clear'), { method: 'POST', query: tq(role, branch) });
export const publishTimetable = (role, examId, branch) => apiRequest(tt(role, examId, '/publish'), { method: 'POST', query: tq(role, branch) });
export const moveSitting = (role, examId, branch, sittingId, body) => apiRequest(tt(role, examId, `/sittings/${id(sittingId)}/move`), { method: 'POST', body, query: tq(role, branch) });
export const setInvigilators = (role, examId, branch, sessionId, body) => apiRequest(tt(role, examId, `/sessions/${id(sessionId)}/invigilators`), { method: 'PUT', body, query: tq(role, branch) });
/** { session, rooms: [{ room, seats: [{ seatNumber, student, section, subject }] }] } */
/** Staff × examination days: { filters, options: { shifts, sessions, dates }, days, rows: [{ staff, cells: { date: [{ room, start, end, shiftName, sequence }] }, duties }], summary }. */
const matrixQuery = (role, branch, f = {}) => ({ ...tq(role, branch), shift: f.shift || undefined, session: f.session || undefined, from: f.from || undefined, to: f.to || undefined });
export const loadInvigilatorMatrix = (role, examId, branch, filters) => apiRequest(tt(role, examId, '/invigilators'), { query: matrixQuery(role, branch, filters) });
export const downloadInvigilatorMatrix = (role, examId, branch, filters, format) => apiDownload(tt(role, examId, '/invigilators/export'), { query: { ...matrixQuery(role, branch, filters), format } });
export const loadSessionSeats = (role, examId, branch, sessionId) => apiRequest(tt(role, examId, `/sessions/${id(sessionId)}/seats`), { query: tq(role, branch) });

// ---- attendance (from the day of the session on) ----
/** { session, canEdit, rooms: [{ room, seats: [{ seatNumber, student, section, subject, attendance, note }], summary, invigilators }], summary } */
export const loadSessionAttendance = (role, examId, sessionId) => apiRequest(`${base(role)}/examinations/${id(examId)}/sessions/${id(sessionId)}/attendance`);
export const saveSessionAttendance = (role, examId, sessionId, body) => apiRequest(`${base(role)}/examinations/${id(examId)}/sessions/${id(sessionId)}/attendance`, { method: 'PUT', body });

// ---- marks (errors also 409 NOT_OPEN / SHEET_APPROVED / MARKS_INCOMPLETE / NOT_SUBMITTED / RESULTS_PUBLISHED) ----
/** { examination, today, counts, items: [{ paper, section, status, entered, students, deadline, overdue, teachers }] } */
export const loadMarkSheets = (role, examId, { branch, status } = {}) => apiRequest(`${base(role)}/examinations/${id(examId)}/marks`, { query: { branch: owner(role, branch), status: status && status !== 'all' ? status : undefined } });
const sheet = (role, paperId, sectionId, path = '') => `${base(role)}/marks/${id(paperId)}/${id(sectionId)}${path}`;
/** { paper, section, examination, status, deadline, opened, actions, stats, students: [{ student, attendance, absent, excused, marks, lockedByAttendance }] } */
export const loadMarkSheet = (role, paperId, sectionId) => apiRequest(sheet(role, paperId, sectionId));
export const saveMarkSheet = (role, paperId, sectionId, marks) => apiRequest(sheet(role, paperId, sectionId), { method: 'PUT', body: { marks } });
export const submitMarkSheet = (role, paperId, sectionId) => apiRequest(sheet(role, paperId, sectionId, '/submit'), { method: 'POST' });
export const approveMarkSheet = (role, paperId, sectionId) => apiRequest(sheet(role, paperId, sectionId, '/approve'), { method: 'POST' });
export const returnMarkSheet = (role, paperId, sectionId, reason) => apiRequest(sheet(role, paperId, sectionId, '/return'), { method: 'POST', body: { reason } });

// ---- documents (Unicode PDFs): { blob, filename } ----
export const downloadExamDocument = (role, examId, kind, { branch, session } = {}) => apiDownload(`${base(role)}/examinations/${id(examId)}/documents/${kind}`, { query: { branch: owner(role, branch), session } });
export const downloadMarkSheet = (role, paperId, sectionId, blank) => apiDownload(sheet(role, paperId, sectionId, '/pdf'), { query: { blank: blank ? 'true' : undefined } });

// ---- results (errors also 409 MARKS_NOT_APPROVED / RESULTS_NOT_DRAFT / RESULTS_NOT_APPROVED / CORRECTION_PERIOD_OVER) ----
const results = (role, examId, path = '') => `${base(role)}/examinations/${id(examId)}/results${path}`;
/** { examination, counts, items: [{ section, status, revision, sheets, summary, actions }] } */
export const loadResults = (role, examId, branch) => apiRequest(results(role, examId), { query: { branch: owner(role, branch) } });
export const publishAllResults = (role, examId, branch) => apiRequest(results(role, examId, '/publish-all'), { method: 'POST', query: { branch: owner(role, branch) } });
/** { section, status, revision, live, papers, students, summary, revisions, settings, actions } */
export const loadSectionResults = (role, examId, sectionId) => apiRequest(results(role, examId, `/${id(sectionId)}`));
export const resultsStep = (role, examId, sectionId, step, body) => apiRequest(results(role, examId, `/${id(sectionId)}/${step}`), { method: 'POST', body });
export const downloadReportCards = (role, examId, sectionId, student) => apiDownload(results(role, examId, `/${id(sectionId)}/report-cards`), { query: { student } });
/** { academicYear, section, formula, passPercent, examinations, students: [{ student, exams, percent, grade, passed, basis, enrollmentResult }] } */
export const loadFinalResults = (role, { academicYear, section }) => apiRequest(`${base(role)}/final-results`, { query: { academicYear, section } });
export const handOverFinalResults = (role, body) => apiRequest(`${base(role)}/final-results/hand-over`, { method: 'POST', body });

/** { examination, level, provisional, overall, grades, classes, subjects, branches?, top?, spread? } */
export const loadExamAnalytics = (role, examId, branch) => apiRequest(`${base(role)}/examinations/${id(examId)}/analytics`, { query: { branch: owner(role, branch) } });

// ---- paper files (private storage; 503 STORAGE_NOT_CONFIGURED until set up) ----
const files = (role, paperId, path = '') => `${base(role)}/papers/${id(paperId)}/files${path}`;
/** { configured, canChange, maxBytes, types, files: [{ id, kind, fileName, size, status, uploadedBy, createdAt }] } */
export const loadPaperFiles = (role, paperId) => apiRequest(files(role, paperId));
/** Uploads a File: asks for a signed link, sends the file straight to storage, then confirms it. */
export async function uploadPaperFile(role, paperId, file, kind) {
  const { file: record, upload } = await apiRequest(files(role, paperId), { method: 'POST', body: { kind, fileName: file.name, contentType: file.type, size: file.size } });
  let response;
  try {
    response = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  } catch {
    throw new Error('The file could not be sent to storage. Check your connection and try again.');
  }
  if (!response.ok) throw new Error('Storage did not accept the file. Try again.');
  return apiRequest(files(role, paperId, `/${id(record.id)}/confirm`), { method: 'POST' });
}
/** { url, expiresAt } — a short-lived link (the download is recorded). */
export const paperFileLink = (role, paperId, fileId) => apiRequest(files(role, paperId, `/${id(fileId)}/download`), { method: 'POST' });
export const removePaperFile = (role, paperId, fileId) => apiRequest(files(role, paperId, `/${id(fileId)}/remove`), { method: 'POST' });

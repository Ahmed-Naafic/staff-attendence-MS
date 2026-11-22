import { forbidden } from '../../common/httpError.js';
import { jsonBody } from '../../common/validate.js';
import { requireExaminations } from '../../middleware/requireExaminations.js';
import { createPeriod, createScale, createType, getExamOverview, getFormula, listPeriods, listScales, listTypes, saveFormula, setPeriodActive, setScaleActive, setTypeActive, updatePeriod, updateScale, updateType } from './examConfig.service.js';
import { readCancel, readExamAttendance, readExamination, readFinalResultsQuery, readHandOver, readMarkEntries, readMarkSheetsQuery, readReturnReason, readExaminationsQuery, readInvigilators, readInvigilatorFilters, readSittingMove, readTimetableBranch, readTimetableGenerate, readExamListQuery, readExamSettingsChange, readExamType, readFormula, readGradingScale, readPaper, readPeriod, readRoom } from './examInput.js';
import {
  addPaper,
  cancelExamination,
  createExamination,
  endExamination,
  examinationOptions,
  getExamination,
  listExaminations,
  removePaper,
  scheduleExamination,
  unscheduleExamination,
  updateExamination,
  updatePaper,
} from './examinations.service.js';
import { getSessionAttendance, saveSessionAttendance } from './examAttendance.service.js';
import { examDocument, markSheetDocument, sendPdf } from './examDocuments.service.js';
import { examAnalytics } from './examAnalytics.service.js';
import { confirmPaperUpload, listPaperFiles, paperFileDownload, readPaperUpload, removePaperFile, startPaperUpload } from './examFiles.service.js';
import { approveResults, correctResults, finalResults, getSectionResults, handOverFinalResults, listResults, publishAllResults, publishResults, reopenResults, reportCards } from './examResults.service.js';
import { approveMarkSheet, getMarkSheet, listMarkSheets, returnMarkSheet, saveMarkSheet, submitMarkSheet } from './examMarks.service.js';
import { clearTimetable, generateTimetable, getTimetable, moveSitting, publishTimetable, sessionSeats, setInvigilators, timetableOptions } from './examTimetable.service.js';
import { getInvigilatorMatrix, invigilatorMatrixPdf, invigilatorMatrixXlsx } from './examInvigilators.js';
import { createRoom, listRooms, setRoomActive, updateRoom } from './examRooms.service.js';
import { getExamSettings, saveExamSettings } from './examSettings.js';

/**
 * Examination routes (docs/business-rules.md → Examinations), the same for the School Owner
 * (/api/owner) and a Manager (/api/manager): `scopeOf(req)` → { school, branch } from the account,
 * `role` 'OWNER' | 'MANAGER'. Everything needs the module switched on for the school (403
 * FEATURE_DISABLED), except the overview, which says whether it is. Configuration changes are the
 * School Owner's (the services refuse a Manager, 403); rooms and the settings branches may set are
 * a Manager's for their branch.
 */
export function mountExaminationRoutes(router, scopeOf, role) {
  router.get('/exams/overview', async (req, res) => {
    res.json(await getExamOverview(scopeOf(req)));
  });
  router.use('/exams', requireExaminations((req) => scopeOf(req).school.id));
  // The configuration is the School Owner's: a Manager's change is refused before its content is read.
  const CONFIG = /^\/(periods|types|grading-scales|formula)(\/|$)/;
  router.use('/exams', (req, res, next) => (role === 'MANAGER' && req.method !== 'GET' && CONFIG.test(req.path) ? next(forbidden('Only the School Owner changes the examination configuration.')) : next()));

  // Settings (layered: school, and a branch for what the school allows).
  router.get('/exams/settings', async (req, res) => {
    res.json(await getExamSettings(scopeOf(req)));
  });
  router.put('/exams/settings', async (req, res) => {
    res.json(await saveExamSettings(scopeOf(req), readExamSettingsChange(jsonBody(req), { role }), req.user, req));
  });

  // Academic periods.
  router.get('/exams/periods', async (req, res) => {
    res.json(await listPeriods(scopeOf(req), readExamListQuery(req.query, { role })));
  });
  router.post('/exams/periods', async (req, res) => {
    res.status(201).json({ period: await createPeriod(scopeOf(req), readPeriod(jsonBody(req), { creating: true }), req.user, req) });
  });
  router.patch('/exams/periods/:id', async (req, res) => {
    res.json({ period: await updatePeriod(scopeOf(req), req.params.id, readPeriod(jsonBody(req), { creating: false }), req.user, req) });
  });
  router.post('/exams/periods/:id/deactivate', async (req, res) => {
    res.json({ period: await setPeriodActive(scopeOf(req), req.params.id, false, req.user, req) });
  });
  router.post('/exams/periods/:id/reactivate', async (req, res) => {
    res.json({ period: await setPeriodActive(scopeOf(req), req.params.id, true, req.user, req) });
  });

  // Examination types.
  router.get('/exams/types', async (req, res) => {
    res.json(await listTypes(scopeOf(req), readExamListQuery(req.query, { role })));
  });
  router.post('/exams/types', async (req, res) => {
    res.status(201).json({ type: await createType(scopeOf(req), readExamType(jsonBody(req), { creating: true }), req.user, req) });
  });
  router.patch('/exams/types/:id', async (req, res) => {
    res.json({ type: await updateType(scopeOf(req), req.params.id, readExamType(jsonBody(req), { creating: false }), req.user, req) });
  });
  router.post('/exams/types/:id/deactivate', async (req, res) => {
    res.json({ type: await setTypeActive(scopeOf(req), req.params.id, false, req.user, req) });
  });
  router.post('/exams/types/:id/reactivate', async (req, res) => {
    res.json({ type: await setTypeActive(scopeOf(req), req.params.id, true, req.user, req) });
  });

  // Grading scales.
  router.get('/exams/grading-scales', async (req, res) => {
    res.json(await listScales(scopeOf(req), readExamListQuery(req.query, { role })));
  });
  router.post('/exams/grading-scales', async (req, res) => {
    res.status(201).json({ scale: await createScale(scopeOf(req), readGradingScale(jsonBody(req), { creating: true }), req.user, req) });
  });
  router.patch('/exams/grading-scales/:id', async (req, res) => {
    res.json({ scale: await updateScale(scopeOf(req), req.params.id, readGradingScale(jsonBody(req), { creating: false }), req.user, req) });
  });
  router.post('/exams/grading-scales/:id/deactivate', async (req, res) => {
    res.json({ scale: await setScaleActive(scopeOf(req), req.params.id, false, req.user, req) });
  });
  router.post('/exams/grading-scales/:id/reactivate', async (req, res) => {
    res.json({ scale: await setScaleActive(scopeOf(req), req.params.id, true, req.user, req) });
  });

  // Final result calculation of a year.
  router.get('/exams/formula', async (req, res) => {
    res.json(await getFormula(scopeOf(req), readExamListQuery(req.query, { role })));
  });
  router.put('/exams/formula', async (req, res) => {
    res.json(await saveFormula(scopeOf(req), readExamListQuery(req.query, { role }).academicYear, readFormula(jsonBody(req)), req.user, req));
  });

  // Rooms (no location).
  router.get('/exams/rooms', async (req, res) => {
    const { status, branch } = readExamListQuery(req.query, { role });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
    res.json(await listRooms(scopeOf(req), { status, branch, q }));
  });
  router.post('/exams/rooms', async (req, res) => {
    res.status(201).json({ room: await createRoom(scopeOf(req), readRoom(jsonBody(req), { creating: true, role }), req.user, req) });
  });
  router.patch('/exams/rooms/:id', async (req, res) => {
    res.json({ room: await updateRoom(scopeOf(req), req.params.id, readRoom(jsonBody(req), { creating: false, role }), req.user, req) });
  });
  router.post('/exams/rooms/:id/deactivate', async (req, res) => {
    res.json({ room: await setRoomActive(scopeOf(req), req.params.id, false, req.user, req) });
  });
  router.post('/exams/rooms/:id/reactivate', async (req, res) => {
    res.json({ room: await setRoomActive(scopeOf(req), req.params.id, true, req.user, req) });
  });

  // Examinations (the School Owner any; a Manager their branch's, when the school allows it).
  router.get('/exams/examinations', async (req, res) => {
    res.json(await listExaminations(scopeOf(req), readExaminationsQuery(req.query, { role })));
  });
  router.get('/exams/examinations/options', async (req, res) => {
    res.json(await examinationOptions(scopeOf(req), readExamListQuery(req.query, { role })));
  });
  router.post('/exams/examinations', async (req, res) => {
    res.status(201).json(await createExamination(scopeOf(req), readExamination(jsonBody(req), { creating: true, role }), req.user, req));
  });
  router.get('/exams/examinations/:id', async (req, res) => {
    res.json(await getExamination(scopeOf(req), req.params.id));
  });
  router.patch('/exams/examinations/:id', async (req, res) => {
    res.json(await updateExamination(scopeOf(req), req.params.id, readExamination(jsonBody(req), { creating: false, role }), req.user, req));
  });
  router.post('/exams/examinations/:id/schedule', async (req, res) => {
    res.json(await scheduleExamination(scopeOf(req), req.params.id, req.user, req));
  });
  router.post('/exams/examinations/:id/unschedule', async (req, res) => {
    res.json(await unscheduleExamination(scopeOf(req), req.params.id, req.user, req));
  });
  router.post('/exams/examinations/:id/cancel', async (req, res) => {
    res.json(await cancelExamination(scopeOf(req), req.params.id, readCancel(jsonBody(req)), req.user, req));
  });
  router.post('/exams/examinations/:id/end', async (req, res) => {
    res.json(await endExamination(scopeOf(req), req.params.id, readCancel(jsonBody(req)), req.user, req));
  });
  router.post('/exams/examinations/:id/papers', async (req, res) => {
    res.status(201).json(await addPaper(scopeOf(req), req.params.id, readPaper(jsonBody(req), { creating: true }), req.user, req));
  });
  router.patch('/exams/examinations/:id/papers/:paperId', async (req, res) => {
    res.json(await updatePaper(scopeOf(req), req.params.id, req.params.paperId, readPaper(jsonBody(req), { creating: false }), req.user, req));
  });
  router.delete('/exams/examinations/:id/papers/:paperId', async (req, res) => {
    res.json(await removePaper(scopeOf(req), req.params.id, req.params.paperId, req.user, req));
  });

  // Timetable of one branch (the School Owner names it with ?branch=; a Manager's is theirs).
  const branchOf = (req) => ({ branch: readTimetableBranch(req.query, { role }) });
  router.get('/exams/examinations/:id/timetable', async (req, res) => {
    res.json(await getTimetable(scopeOf(req), req.params.id, branchOf(req)));
  });
  // Invigilator matrix (staff × days, rooms with session times) and its exports with the same filters.
  router.get('/exams/examinations/:id/timetable/invigilators', async (req, res) => {
    res.json(await getInvigilatorMatrix(scopeOf(req), req.params.id, branchOf(req), readInvigilatorFilters(req.query)));
  });
  router.get('/exams/examinations/:id/timetable/invigilators/export', async (req, res) => {
    const { format, ...filters } = readInvigilatorFilters(req.query, { exporting: true });
    const matrix = await getInvigilatorMatrix(scopeOf(req), req.params.id, branchOf(req), filters);
    if (format === 'pdf') return sendPdf(res, invigilatorMatrixPdf(scopeOf(req), matrix));
    const { buffer, filename } = invigilatorMatrixXlsx(matrix);
    res.status(200).set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'no-store' });
    return res.send(buffer);
  });
  router.get('/exams/examinations/:id/timetable/options', async (req, res) => {
    res.json(await timetableOptions(scopeOf(req), req.params.id, branchOf(req)));
  });
  router.post('/exams/examinations/:id/timetable/generate', async (req, res) => {
    res.json(await generateTimetable(scopeOf(req), req.params.id, branchOf(req), readTimetableGenerate(jsonBody(req)), req.user, req));
  });
  router.post('/exams/examinations/:id/timetable/clear', async (req, res) => {
    res.json(await clearTimetable(scopeOf(req), req.params.id, branchOf(req), req.user, req));
  });
  router.post('/exams/examinations/:id/timetable/publish', async (req, res) => {
    res.json(await publishTimetable(scopeOf(req), req.params.id, branchOf(req), req.user, req));
  });
  router.post('/exams/examinations/:id/timetable/sittings/:sittingId/move', async (req, res) => {
    res.json(await moveSitting(scopeOf(req), req.params.id, req.params.sittingId, branchOf(req), readSittingMove(jsonBody(req)), req.user, req));
  });
  router.put('/exams/examinations/:id/timetable/sessions/:sessionId/invigilators', async (req, res) => {
    res.json(await setInvigilators(scopeOf(req), req.params.id, req.params.sessionId, branchOf(req), readInvigilators(jsonBody(req)), req.user, req));
  });
  // Marks: sheets of an examination, and one sheet (paper × section).
  router.get('/exams/examinations/:id/marks', async (req, res) => {
    res.json(await listMarkSheets(scopeOf(req), req.params.id, readMarkSheetsQuery(req.query, { role })));
  });
  router.get('/exams/marks/:paperId/:sectionId', async (req, res) => {
    res.json(await getMarkSheet(scopeOf(req), req.params.paperId, req.params.sectionId));
  });
  router.put('/exams/marks/:paperId/:sectionId', async (req, res) => {
    res.json(await saveMarkSheet(scopeOf(req), req.params.paperId, req.params.sectionId, readMarkEntries(jsonBody(req)), req.user, req));
  });
  router.post('/exams/marks/:paperId/:sectionId/submit', async (req, res) => {
    res.json(await submitMarkSheet(scopeOf(req), req.params.paperId, req.params.sectionId, req.user, req));
  });
  router.post('/exams/marks/:paperId/:sectionId/approve', async (req, res) => {
    res.json(await approveMarkSheet(scopeOf(req), req.params.paperId, req.params.sectionId, req.user, req));
  });
  router.post('/exams/marks/:paperId/:sectionId/return', async (req, res) => {
    res.json(await returnMarkSheet(scopeOf(req), req.params.paperId, req.params.sectionId, readReturnReason(jsonBody(req)), req.user, req));
  });

  // Documents (Unicode PDFs): timetable | duties (?branch) and seating | register (?session); mark sheets.
  router.get('/exams/examinations/:id/documents/:kind', async (req, res) => {
    const one = (k) => (typeof req.query[k] === 'string' && /^[0-9a-f-]{36}$/i.test(req.query[k]) ? req.query[k] : undefined);
    sendPdf(res, await examDocument(scopeOf(req), req.params.id, req.params.kind, { branch: role === 'OWNER' ? one('branch') : undefined, session: one('session') }));
  });
  router.get('/exams/marks/:paperId/:sectionId/pdf', async (req, res) => {
    sendPdf(res, await markSheetDocument(scopeOf(req), req.params.paperId, req.params.sectionId, { blank: req.query.blank === 'true' }));
  });

  // Results of an examination, per section; report cards; the year's final results.
  const branchQuery = (req) => ({ branch: role === 'OWNER' && typeof req.query.branch === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.branch) ? req.query.branch : undefined });
  router.get('/exams/examinations/:id/results', async (req, res) => {
    res.json(await listResults(scopeOf(req), req.params.id, branchQuery(req)));
  });
  router.post('/exams/examinations/:id/results/publish-all', async (req, res) => {
    res.json(await publishAllResults(scopeOf(req), req.params.id, branchQuery(req), req.user, req));
  });
  router.get('/exams/examinations/:id/results/:sectionId', async (req, res) => {
    res.json(await getSectionResults(scopeOf(req), req.params.id, req.params.sectionId));
  });
  router.post('/exams/examinations/:id/results/:sectionId/approve', async (req, res) => {
    res.json(await approveResults(scopeOf(req), req.params.id, req.params.sectionId, req.user, req));
  });
  router.post('/exams/examinations/:id/results/:sectionId/reopen', async (req, res) => {
    res.json(await reopenResults(scopeOf(req), req.params.id, req.params.sectionId, req.user, req));
  });
  router.post('/exams/examinations/:id/results/:sectionId/publish', async (req, res) => {
    res.json(await publishResults(scopeOf(req), req.params.id, req.params.sectionId, req.user, req));
  });
  router.post('/exams/examinations/:id/results/:sectionId/correct', async (req, res) => {
    res.json(await correctResults(scopeOf(req), req.params.id, req.params.sectionId, readReturnReason(jsonBody(req)), req.user, req));
  });
  router.get('/exams/examinations/:id/results/:sectionId/report-cards', async (req, res) => {
    const student = typeof req.query.student === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.student) ? req.query.student : undefined;
    sendPdf(res, await reportCards(scopeOf(req), req.params.id, req.params.sectionId, { student }));
  });
  router.get('/exams/examinations/:id/analytics', async (req, res) => {
    res.json(await examAnalytics(scopeOf(req), req.params.id, branchQuery(req)));
  });
  // Paper files (private storage): list, upload (signed URL, then confirm), download link (audited), remove.
  router.get('/exams/papers/:paperId/files', async (req, res) => {
    res.json(await listPaperFiles(scopeOf(req), req.params.paperId));
  });
  router.post('/exams/papers/:paperId/files', async (req, res) => {
    res.status(201).json(await startPaperUpload(scopeOf(req), req.params.paperId, readPaperUpload(jsonBody(req)), req.user, req));
  });
  router.post('/exams/papers/:paperId/files/:fileId/confirm', async (req, res) => {
    res.json(await confirmPaperUpload(scopeOf(req), req.params.paperId, req.params.fileId, req.user, req));
  });
  router.post('/exams/papers/:paperId/files/:fileId/download', async (req, res) => {
    res.json(await paperFileDownload(scopeOf(req), req.params.paperId, req.params.fileId, req.user, req));
  });
  router.post('/exams/papers/:paperId/files/:fileId/remove', async (req, res) => {
    res.json(await removePaperFile(scopeOf(req), req.params.paperId, req.params.fileId, req.user, req));
  });
  router.get('/exams/final-results', async (req, res) => {
    res.json(await finalResults(scopeOf(req), readFinalResultsQuery(req.query)));
  });
  router.post('/exams/final-results/hand-over', async (req, res) => {
    res.json(await handOverFinalResults(scopeOf(req), readHandOver(jsonBody(req)), req.user, req));
  });

  // Attendance of a session (from its day on).
  router.get('/exams/examinations/:id/sessions/:sessionId/attendance', async (req, res) => {
    res.json(await getSessionAttendance(scopeOf(req), req.params.id, req.params.sessionId));
  });
  router.put('/exams/examinations/:id/sessions/:sessionId/attendance', async (req, res) => {
    res.json(await saveSessionAttendance(scopeOf(req), req.params.id, req.params.sessionId, readExamAttendance(jsonBody(req)), req.user, req));
  });
  router.get('/exams/examinations/:id/timetable/sessions/:sessionId/seats', async (req, res) => {
    res.json(await sessionSeats(scopeOf(req), req.params.id, req.params.sessionId, branchOf(req)));
  });
}

import { jsonBody } from '../../common/validate.js';
import {
  addFixedLesson,
  discardDraft,
  editDraft,
  generate,
  getBuilder,
  getDraft,
  listTeachers,
  publishDraft,
  readiness,
  removeFixedLesson,
  saveSetup,
  saveTeacherLimits,
} from './builder.service.js';
import { readBuilderQuery, readDraftEdit, readFixedLesson, readGenerate, readPublish, readRevision, readSetup, readTeacherLimits, readViewQuery } from './builderInput.js';
import { sendTimetablePdf, sendTimetableXlsx } from './timetableExport.js';
import { masterView, sectionView, teacherView } from './views.service.js';

/*
 * Timetable builder and timetable view routes (docs/business-rules.md → Timetable builder), the same
 * for the School Owner (/api/owner, naming the branch) and a Manager (/api/manager, their branch):
 * the scope decides what each sees and changes. Academic setup: available whether or not Student
 * Attendance is switched on.
 */
export function mountTimetableBuilderRoutes(router, scopeOf, role) {
  const base = '/timetable-builder';
  router.get(base, async (req, res) => {
    res.json(await getBuilder(scopeOf(req), readBuilderQuery(req.query, { role })));
  });
  router.put(`${base}/setup`, async (req, res) => {
    res.json(await saveSetup(scopeOf(req), readSetup(jsonBody(req), { role }), req.user, req));
  });
  router.get(`${base}/readiness`, async (req, res) => {
    res.json(await readiness(scopeOf(req), readBuilderQuery(req.query, { role })));
  });
  router.get(`${base}/teachers`, async (req, res) => {
    res.json(await listTeachers(scopeOf(req), readBuilderQuery(req.query, { role })));
  });
  router.put(`${base}/teachers/:id`, async (req, res) => {
    res.json(await saveTeacherLimits(scopeOf(req), req.params.id, readTeacherLimits(jsonBody(req)), req.user, req));
  });
  router.post(`${base}/fixed-lessons`, async (req, res) => {
    res.status(201).json(await addFixedLesson(scopeOf(req), readFixedLesson(jsonBody(req), { role }), req.user, req));
  });
  router.delete(`${base}/fixed-lessons/:id`, async (req, res) => {
    res.json(await removeFixedLesson(scopeOf(req), req.params.id, req.user, req));
  });
  router.post(`${base}/generate`, async (req, res) => {
    res.status(201).json(await generate(scopeOf(req), readGenerate(jsonBody(req), { role }), req.user));
  });
  router.get(`${base}/draft`, async (req, res) => {
    res.json(await getDraft(scopeOf(req), readBuilderQuery(req.query, { role })));
  });
  router.post(`${base}/drafts/:id/edit`, async (req, res) => {
    res.json(await editDraft(scopeOf(req), req.params.id, readDraftEdit(jsonBody(req))));
  });
  router.post(`${base}/drafts/:id/publish`, async (req, res) => {
    res.json(await publishDraft(scopeOf(req), req.params.id, readPublish(jsonBody(req)), req.user, req));
  });
  router.post(`${base}/drafts/:id/discard`, async (req, res) => {
    res.json(await discardDraft(scopeOf(req), req.params.id, readRevision(jsonBody(req))));
  });

  // Views: master (a branch), class (a section), teacher. ?source=published|draft&date=; .xlsx / .pdf.
  const views = [
    ['/timetable-views/master', (req) => masterView(scopeOf(req), readViewQuery(req.query, { role, needBranch: true }))],
    ['/timetable-views/sections/:id', (req) => sectionView(scopeOf(req), req.params.id, readViewQuery(req.query, { role }))],
    ['/timetable-views/teachers/:id', (req) => teacherView(scopeOf(req), req.params.id, readViewQuery(req.query, { role }))],
  ];
  for (const [path, load] of views) {
    router.get(path, async (req, res) => res.json(await load(req)));
    router.get(`${path}/export.xlsx`, async (req, res) => sendTimetableXlsx(res, await load(req)));
    router.get(`${path}/export.pdf`, async (req, res) => sendTimetablePdf(res, await load(req)));
  }
}

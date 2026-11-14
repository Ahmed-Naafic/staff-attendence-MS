import { apiRequest } from '../../../lib/api.js';

/*
 * Subjects, class curricula and teaching assignments. The school, and a Manager's branch, are
 * decided by the server from the account. Writes throw ApiError: 400 VALIDATION_ERROR (details per
 * field), 403 FORBIDDEN, 404 NOT_FOUND, 409 NAME_TAKEN / CODE_TAKEN / SUBJECT_IN_USE /
 * SUBJECT_UNAVAILABLE / SUBJECT_INACTIVE / SUBJECT_NOT_IN_CLASS / SECTION_INACTIVE / TEACHER_SUSPENDED /
 * CLASS_TEACHER_EXISTS / ALREADY_ASSIGNED / ASSIGNMENT_STARTED / ASSIGNMENT_IN_PAST / ASSIGNMENT_CANCELLED /
 * YEAR_CLOSED / SCHOOL_SUSPENDED / BRANCH_NOT_OPERATING.
 */
const base = (role) => (role === 'OWNER' ? '/owner' : '/manager');
const id = (value) => encodeURIComponent(value);

// ---- subjects (Owner writes; both read) ----
export const loadSubjects = (role, { q, status } = {}) => apiRequest(`${base(role)}/subjects`, { query: { q, status } });
export const createSubject = async (values) => (await apiRequest('/owner/subjects', { method: 'POST', body: values })).subject;
export const updateSubject = async (subjectId, values) => (await apiRequest(`/owner/subjects/${id(subjectId)}`, { method: 'PATCH', body: values })).subject;
export const setSubjectActive = async (subjectId, active) =>
  (await apiRequest(`/owner/subjects/${id(subjectId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).subject;

// ---- class curricula ----
/** { class, open, weeklyLessons, items: [{ subject, weeklyLessons }] } */
export const loadCurriculum = (role, classId) => apiRequest(`${base(role)}/classes/${id(classId)}/subjects`);
/** subjects: [{ subject: id, weeklyLessons }] → the curriculum. */
export const saveCurriculum = (classId, subjects) => apiRequest(`/owner/classes/${id(classId)}/subjects`, { method: 'PUT', body: { subjects } });

// ---- teaching assignments ----
export const loadAssignments = (role, filters = {}) =>
  apiRequest(`${base(role)}/teaching-assignments`, { query: { ...filters, branch: role === 'OWNER' ? filters.branch : undefined } });
/** One section: { section, curriculumSet, classTeachers, subjects: [{ subject, weeklyLessons, teachers }], today, firstEditableDate }. */
export const loadSectionTeaching = (role, sectionId) => apiRequest(`${base(role)}/sections/${id(sectionId)}/teaching`);
/**
 * Staff who can teach: show 'teachers' (job title is a teaching one; default) or 'all' (every active
 * staff member, teachers first). { show, total, items: [{ id, name, staffId, jobTitle, homeBranch, suggested, liveAssignments }] } (at most 50).
 */
export const loadTeachers = (role, { q, academicYear, show } = {}) => apiRequest(`${base(role)}/teaching/teachers`, { query: { q, academicYear, show } });
/** values: { role: 'subject' | 'class', teacher, section, subject?, startDate?, endDate? } → the assignment. */
export const assignTeaching = async (role, values) => (await apiRequest(`${base(role)}/teaching-assignments`, { method: 'POST', body: values })).assignment;
export const setAssignmentEnd = async (role, assignmentId, lastDay) =>
  (await apiRequest(`${base(role)}/teaching-assignments/${id(assignmentId)}/end`, { method: 'POST', body: { lastDay } })).assignment;
export const cancelAssignment = async (role, assignmentId) => (await apiRequest(`${base(role)}/teaching-assignments/${id(assignmentId)}/cancel`, { method: 'POST' })).assignment;

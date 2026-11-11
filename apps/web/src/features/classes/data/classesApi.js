import { apiRequest } from '../../../lib/api.js';

/*
 * Classes and sections. The school (and a Manager's branch) is always decided by the server from the
 * signed-in account; these calls only send filters and form values. Writes throw ApiError: 400
 * VALIDATION_ERROR (details per field), 404 NOT_FOUND, 409 NAME_TAKEN / SEQUENCE_TAKEN / CLASS_IN_USE /
 * CLASS_INACTIVE / YEAR_CLOSED / INVALID_STATUS / SCHOOL_SUSPENDED / BRANCH_NOT_OPERATING.
 */
const base = (role) => (role === 'OWNER' ? '/owner' : '/manager');
const id = (value) => encodeURIComponent(value);

/** { academicYear, items: [class with sections, inactiveSections, capacity] } */
export const loadClasses = (role, { academicYear, branch, q, status } = {}) =>
  apiRequest(`${base(role)}/classes`, { query: { academicYear, branch: role === 'OWNER' ? branch : undefined, q, status } });

/** { class, academicYear, sections } */
export const loadClass = (role, classId, { academicYear, branch } = {}) =>
  apiRequest(`${base(role)}/classes/${id(classId)}`, { query: { academicYear, branch: role === 'OWNER' ? branch : undefined } });

/** Sections of a year in class order ("Grade 7A", "Grade 7B", …): { academicYear, items }. */
export const loadSections = (role, { academicYear, branch, classId, status, q } = {}) =>
  apiRequest(`${base(role)}/sections`, { query: { academicYear, branch: role === 'OWNER' ? branch : undefined, class: classId, status, q } });

/** The Owner's branches (for choosing a section's branch and filtering): [{ id, name, code, status }]. */
export const loadOwnerBranches = async () => (await apiRequest('/owner/branches', { query: { pageSize: 100 } })).items;

// ---- classes (School Owner) ----
export const createClass = async (values) => (await apiRequest('/owner/classes', { method: 'POST', body: values })).class;
export const updateClass = async (classId, values) => (await apiRequest(`/owner/classes/${id(classId)}`, { method: 'PATCH', body: values })).class;
export const setClassActive = async (classId, active) =>
  (await apiRequest(`/owner/classes/${id(classId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).class;

// ---- sections (Owner: any branch of the school; Manager: own branch, never sends a branch) ----
export const createSection = async (role, values) => (await apiRequest(`${base(role)}/sections`, { method: 'POST', body: values })).section;
export const updateSection = async (role, sectionId, values) =>
  (await apiRequest(`${base(role)}/sections/${id(sectionId)}`, { method: 'PATCH', body: values })).section;
export const setSectionActive = async (role, sectionId, active) =>
  (await apiRequest(`${base(role)}/sections/${id(sectionId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).section;

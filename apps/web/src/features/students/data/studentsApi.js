import { apiRequest } from '../../../lib/api.js';

/*
 * Students, enrollments and promotions. The school (and a Manager's branch) is always decided by the
 * server from the signed-in account; these calls only send filters and form values. Failures throw
 * ApiError with a code: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND, 409 POSSIBLE_DUPLICATE /
 * ALREADY_ENROLLED / YEAR_CLOSED / SECTION_INACTIVE / WRONG_YEAR / STUDENT_GRADUATED / MISSING_TARGETS /
 * NOT_DRAFT / BRANCH_NOT_OPERATING / …
 */
const base = (role) => (role === 'OWNER' ? '/owner' : '/manager');
const id = (value) => encodeURIComponent(value);

/** { academicYear, items: [student with `enrollment` in that year], total, page, pageSize, pageCount } */
export const loadStudents = (role, filters) =>
  apiRequest(`${base(role)}/students`, {
    query: { ...filters, branch: role === 'OWNER' ? filters.branch : undefined, class: filters.classId, classId: undefined, section: filters.sectionId, sectionId: undefined },
  });

/** One student with `enrollments` (oldest year first, each with its promotion decision). */
export const loadStudent = async (role, studentId) => (await apiRequest(`${base(role)}/students/${id(studentId)}`)).student;

/** values: profile fields; Owner adds branchId. `confirmDuplicate` registers despite a possible duplicate. */
export const registerStudent = async (role, values) => (await apiRequest(`${base(role)}/students`, { method: 'POST', body: values })).student;
export const updateStudent = async (role, studentId, values) => (await apiRequest(`${base(role)}/students/${id(studentId)}`, { method: 'PATCH', body: values })).student;

// ---- Manager only ----
export const enrollStudent = async (studentId, sectionId) => (await apiRequest(`/manager/students/${id(studentId)}/enrollments`, { method: 'POST', body: { sectionId } })).enrollment;
/** values: { sectionId?, result?: 'PASSED' | 'FAILED' | null } */
export const updateEnrollment = async (enrollmentId, values) => (await apiRequest(`/manager/enrollments/${id(enrollmentId)}`, { method: 'PATCH', body: values })).enrollment;
export const transferOut = async (studentId, reason) => (await apiRequest(`/manager/students/${id(studentId)}/transfer-out`, { method: 'POST', body: { reason } })).student;

// ---- promotions ----
export const loadPromotions = (role) => apiRequest(`${base(role)}/promotions`);
export const loadPromotion = (role, batchId) => apiRequest(`${base(role)}/promotions/${id(batchId)}`);
export const startPromotion = (fromYearId, toYearId) => apiRequest('/manager/promotions', { method: 'POST', body: { fromYearId, toYearId } });
export const refreshPromotion = (batchId) => apiRequest(`/manager/promotions/${id(batchId)}/refresh`, { method: 'POST' });
/** items: [{ id, decision, targetSectionId? }] */
export const updatePromotionItems = (batchId, items) => apiRequest(`/manager/promotions/${id(batchId)}/items`, { method: 'PATCH', body: { items } });
export const confirmPromotion = (batchId) => apiRequest(`/manager/promotions/${id(batchId)}/confirm`, { method: 'POST', body: { confirm: 'PROCESS' } });
export const processPromotion = (batchId) => apiRequest(`/manager/promotions/${id(batchId)}/process`, { method: 'POST' });
export const retryPromotion = (batchId) => apiRequest(`/manager/promotions/${id(batchId)}/retry`, { method: 'POST' });

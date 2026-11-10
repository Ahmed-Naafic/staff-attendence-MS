import { apiRequest } from '../../../lib/api.js';

/*
 * Academic year requests. The school is always decided by the server from the signed-in account
 * (the owner's school, or the Manager's branch's school); nothing here names a school.
 * Writes (School Owner only) throw ApiError: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND,
 * 409 NAME_TAKEN / DATES_OVERLAP / CURRENT_EXISTS / OUT_OF_ORDER / YEAR_CLOSED / INVALID_STATUS / SCHOOL_SUSPENDED.
 */
const path = (id, rest = '') => `/owner/academic-years/${encodeURIComponent(id)}${rest}`;

/** { items: [year], current: year | null } — years newest first. */
export const loadAcademicYears = (role) => apiRequest(role === 'OWNER' ? '/owner/academic-years' : '/manager/academic-years');

/** The owner's school status ('active' | 'suspended'): a suspended school's years are read only. */
export const loadOwnerSchoolStatus = async () => (await apiRequest('/owner/school')).school.status;

/** values: { name, startDate, endDate } (dates 'YYYY-MM-DD'). */
export const createAcademicYear = async (values) => (await apiRequest('/owner/academic-years', { method: 'POST', body: values })).academicYear;

/** values: any of { name, startDate, endDate }. */
export const updateAcademicYear = async (id, values) => (await apiRequest(path(id), { method: 'PATCH', body: values })).academicYear;

/** → { academicYear, closed } (closed: the previous current year, when this start closed it). */
export const startAcademicYear = (id, closeCurrent) => apiRequest(path(id, '/start'), { method: 'POST', body: { closeCurrent } });

export const closeAcademicYear = async (id) => (await apiRequest(path(id, '/close'), { method: 'POST' })).academicYear;

export const deleteAcademicYear = (id) => apiRequest(path(id), { method: 'DELETE' });

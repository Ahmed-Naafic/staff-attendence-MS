import { apiRequest } from '../../../lib/api.js';

/* Platform announcements (Super Admin, docs/notifications/notification-api.md → Announcements). */

export const loadAnnouncements = ({ status, q, page = 1, pageSize = 10 } = {}, signal) =>
  apiRequest('/platform/announcements', { query: { status, q, page, pageSize }, signal });

export const createAnnouncement = (body) => apiRequest('/platform/announcements', { method: 'POST', body }).then((d) => d.announcement);

export const updateAnnouncement = (id, body) => apiRequest(`/platform/announcements/${id}`, { method: 'PATCH', body }).then((d) => d.announcement);

export const publishAnnouncement = (id, publishAt) =>
  apiRequest(`/platform/announcements/${id}/publish`, { method: 'POST', body: publishAt ? { publishAt } : {} }).then((d) => d.announcement);

export const withdrawAnnouncement = (id) => apiRequest(`/platform/announcements/${id}/withdraw`, { method: 'POST', body: {} }).then((d) => d.announcement);

/** Schools for the audience picker (search by name or code; at most 100 at a time). */
export const searchSchools = (q, signal) => apiRequest('/platform/schools', { query: { q, page: 1, pageSize: 100 }, signal }).then((d) => d.items);

/*
 * Notification centre API (docs/notifications/notification-api.md) for the Staff app. The server
 * returns only the signed-in staff member's own notifications and the announcements for staff of
 * their school; texts are already in Somali.
 */
export const fetchNotifications = (api, { page = 1, pageSize = 30, unread = false } = {}) =>
  api.request(`/api/notifications?page=${page}&pageSize=${pageSize}${unread ? '&unread=true' : ''}`).then(({ data }) => data);

export const fetchUnreadCount = (api) => api.request('/api/notifications/unread-count').then(({ data }) => data.unreadCount);

export const markRead = (api, item) => api.request(`/api/notifications/${item.source}/${item.id}/read`, { method: 'POST' }).then(({ data }) => data.item);

export const markAllRead = (api) => api.request('/api/notifications/read-all', { method: 'POST' }).then(({ data }) => data);

export const fetchPreferences = (api) => api.request('/api/notifications/preferences').then(({ data }) => data);

export const savePreferences = (api, values) => api.request('/api/notifications/preferences', { method: 'PUT', body: values }).then(({ data }) => data);

export const registerDevice = (api, { token, platform }) => api.request('/api/notifications/devices', { method: 'POST', body: { token, platform } });

export const unregisterDevice = (api) => api.request('/api/notifications/devices/current', { method: 'DELETE' });

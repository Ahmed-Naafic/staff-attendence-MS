import { apiRequest } from '../../../lib/api.js';

/*
 * Notification centre API (docs/notifications/notification-api.md). The server decides what the
 * signed-in account may see (its own notifications; a Manager's current branch only; announcements
 * for its role and school); nothing here sends a user, school or branch id.
 */

export const loadNotifications = ({ page = 1, pageSize = 20, unread = false, category } = {}, signal) =>
  apiRequest('/notifications', { query: { page, pageSize, unread: unread ? 'true' : undefined, category }, signal });

export const loadUnreadCount = (signal) => apiRequest('/notifications/unread-count', { signal }).then((data) => data.unreadCount);

export const markNotificationRead = (item) => apiRequest(`/notifications/${item.source}/${item.id}/read`, { method: 'POST' }).then((data) => data.item);

export const markAllNotificationsRead = () => apiRequest('/notifications/read-all', { method: 'POST' });

export const loadPreferences = (signal) => apiRequest('/notifications/preferences', { signal });

export const savePreferences = (values) => apiRequest('/notifications/preferences', { method: 'PUT', body: values });

/** Manager: reminder settings for the staff of their branch (within the platform limits). */
export const loadBranchReminders = (signal) => apiRequest('/manager/notification-settings', { signal });

export const saveBranchReminders = (values) => apiRequest('/manager/notification-settings', { method: 'PUT', body: values });

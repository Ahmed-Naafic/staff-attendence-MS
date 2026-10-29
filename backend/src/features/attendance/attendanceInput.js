import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';

/*
 * Validation of a check-in or check-out sent by the Staff mobile app (approved rules:
 * docs/business-rules.md → Attendance check-in and check-out). Only the shape is checked here; the
 * clock, event-time, shift, suspension and geofence rules are applied by the service, against the
 * server's time and the stored history. The branch, staff member, shift and schedule always come
 * from the server, never from the request.
 */

export const EVENT_TYPES = ['CHECK_IN', 'CHECK_OUT'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const FIXED = {
  staffId: 'The staff member is the signed-in account.',
  staffUserId: 'The staff member is the signed-in account.',
  branchId: 'The branch is your own branch.',
  schoolId: 'The school is your own school.',
  shiftKey: 'The shift is found by the server from your assignments.',
  scheduleId: 'The schedule is found by the server.',
  receivedAt: 'The received time is the server’s.',
  status: 'The status is calculated by the server.',
};

/** An ISO time with an offset or Z → Date, or null. */
function readTime(value) {
  if (typeof value !== 'string' || !ISO.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * { clientEventId, type, occurredAt, sentAt, position: { latitude, longitude, accuracy } } →
 * { clientEventId, type, occurredAt: Date, sentAt: Date, position }. Position values are passed on
 * as sent (the geofence judges them).
 */
export function readAttendanceEvent(body) {
  const keys = Object.keys(body);
  const fixed = keys.filter((k) => FIXED[k]);
  if (fixed.length) throw badRequest(FIXED[fixed[0]], Object.fromEntries(fixed.map((k) => [k, FIXED[k]])));
  const unknown = keys.filter((k) => !['clientEventId', 'type', 'occurredAt', 'sentAt', 'position'].includes(k));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);

  const errors = {};
  if (!isUuid(body.clientEventId)) errors.clientEventId = 'Send the event’s unique id (a UUID created by the app).';
  if (!EVENT_TYPES.includes(body.type)) errors.type = 'The type must be CHECK_IN or CHECK_OUT.';
  const occurredAt = readTime(body.occurredAt);
  if (!occurredAt) errors.occurredAt = 'Send the event time as an ISO time with a time zone offset.';
  const sentAt = readTime(body.sentAt);
  if (!sentAt) errors.sentAt = 'Send the device time at sending as an ISO time with a time zone offset.';
  const position = body.position;
  if (position !== undefined && position !== null) {
    if (typeof position !== 'object' || Array.isArray(position)) errors.position = 'The position must be an object.';
    else {
      const extra = Object.keys(position).filter((k) => !['latitude', 'longitude', 'accuracy'].includes(k));
      if (extra.length) errors.position = `Unknown position fields: ${extra.join(', ')}.`;
    }
  }
  if (Object.keys(errors).length) throw badRequest('Check the event.', errors);
  return { clientEventId: body.clientEventId, type: body.type, occurredAt, sentAt, position: position ?? null };
}

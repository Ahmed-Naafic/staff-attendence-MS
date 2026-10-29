import { badRequest } from './httpError.js';

/*
 * Small validators for query strings, route parameters and JSON bodies. Each reads one value,
 * returns it in its proper type, and throws a 400 with a clear message when it is invalid.
 * Unknown query parameters are ignored; known ones are always validated.
 */

const single = (value, name) => {
  if (Array.isArray(value)) throw badRequest(`"${name}" must be given once.`);
  return value;
};

/** Optional trimmed string up to `max` characters ('' → undefined). */
export function optionalString(source, name, { max = 100 } = {}) {
  const value = single(source[name], name);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`"${name}" must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw badRequest(`"${name}" must be at most ${max} characters.`);
  return trimmed || undefined;
}

/** Required non-empty string. */
export function requiredString(source, name, options) {
  const value = optionalString(source, name, options);
  if (value === undefined) throw badRequest(`"${name}" is required.`);
  return value;
}

/** Optional value from a fixed list. */
export function optionalEnum(source, name, allowed) {
  const value = optionalString(source, name);
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw badRequest(`"${name}" must be one of: ${allowed.join(', ')}.`);
  return value;
}

/** Optional whole number within [min, max], with a default. */
export function optionalInt(source, name, { min = 1, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const value = optionalString(source, name, { max: 12 });
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw badRequest(`"${name}" must be a whole number.`);
  const number = Number(value);
  if (number < min || number > max) throw badRequest(`"${name}" must be between ${min} and ${max}.`);
  return number;
}

/** Optional ISO-8601 date-time → Date. */
export function optionalDate(source, name) {
  const value = optionalString(source, name, { max: 40 });
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(date.getTime())) throw badRequest(`"${name}" must be an ISO date-time.`);
  return date;
}

/** Optional calendar date 'YYYY-MM-DD' (a real date: 2026-02-30 is refused). */
export function optionalDay(source, name) {
  const value = optionalString(source, name, { max: 10 });
  if (value === undefined) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw badRequest(`"${name}" must be a date (YYYY-MM-DD).`);
  }
  return value;
}

/** Route parameter id: a UUID. Anything else cannot exist, so it is reported as not found by callers. */
export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The request body must be a JSON object. */
export function jsonBody(req) {
  if (!req.is('application/json') || typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
    throw badRequest('Send a JSON object.');
  }
  return req.body;
}

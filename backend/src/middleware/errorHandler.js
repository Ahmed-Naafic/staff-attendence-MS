import { HttpError } from '../common/httpError.js';

/**
 * Turns errors into JSON: { error: message, code, details? }.
 * Only HttpErrors (and malformed JSON bodies) reach the client with their message; anything else —
 * Prisma and other internal errors — is logged and reported as a generic 500 without details.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details && { details: err.details }) });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'VALIDATION_ERROR' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again later.', code: 'INTERNAL_ERROR' });
}

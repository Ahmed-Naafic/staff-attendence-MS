/** An error with an HTTP status and a stable code, safe to show to API clients. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this resource.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);
export const tooManyRequests = (message, retryAfterSeconds) => {
  const error = new HttpError(429, 'TOO_MANY_REQUESTS', message);
  error.retryAfter = retryAfterSeconds;
  return error;
};

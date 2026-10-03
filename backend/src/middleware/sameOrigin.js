import { env } from '../config/env.js';
import { forbidden } from '../common/httpError.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery guard for the cookie session: a state-changing request must come
 * from the web app's origin (Origin header) and carry JSON. Browsers always send Origin on
 * cross-site POSTs, and a plain HTML form cannot send application/json.
 */
export function sameOrigin(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== env.webOrigin) return next(forbidden('Requests from this origin are not allowed.'));
  if (req.get('content-length') !== '0' && req.get('content-length') && !req.is('application/json')) {
    return next(forbidden('Send JSON.'));
  }
  next();
}

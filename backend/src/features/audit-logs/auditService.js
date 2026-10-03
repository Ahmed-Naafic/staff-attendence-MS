import { getPrisma } from '../../config/prisma.js';

/**
 * Records an audit event. Never pass passwords, tokens, cookies or request bodies.
 * `actor` is the user who acted ({ id, name, role }) or null when unknown (e.g. a failed sign-in
 * for an email that has no account — the typed email is deliberately not stored).
 */
export async function recordAuditEvent({ action, result = 'SUCCESS', actor, target, schoolId, description, change, req, client = getPrisma() }) {
  return client.auditEvent.create({
    data: {
      action,
      result,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      actorRole: actor?.role ?? null,
      targetType: target.type,
      targetId: target.id ?? null,
      targetName: target.name ?? null,
      schoolId: schoolId ?? null,
      description,
      change: change ?? undefined,
      ipAddress: req ? clientIp(req) : null,
      userAgent: req?.get('user-agent')?.slice(0, 300) ?? null,
    },
  });
}

/** The caller's network address (the socket address; no proxy headers are trusted yet). */
export const clientIp = (req) => (req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '') || null;

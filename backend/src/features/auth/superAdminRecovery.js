import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { hashPassword } from './password.js';

/*
 * Super Admin password recovery, used only by scripts/reset-super-admin-password.js (there is no
 * web or API route). The new hash, the end of the account's sessions and a
 * SUPER_ADMIN_PASSWORD_RESET security event are written in one transaction: if the audit record
 * cannot be written, nothing changes and the error is raised to the caller.
 */

export const CLI_ACTOR_NAME = 'Command-line operator';

/** Thrown when the email does not belong to a SUPER_ADMIN account (the same for every other case). */
export class NotASuperAdminError extends Error {
  constructor() {
    super('No Super Admin account has this email.');
  }
}

/** The SUPER_ADMIN account for an email, or null. Never returns other roles. */
export async function findSuperAdmin(email, client = getPrisma()) {
  const user = await client.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, role: true, status: true } });
  return user?.role === 'SUPER_ADMIN' ? user : null;
}

/**
 * Resets the password of the SUPER_ADMIN account `userId`. `context` describes where the command
 * ran: { tool, host, osUser } (no credentials). Returns { sessionsEnded }.
 * The password is hashed here and never stored, logged or recorded in any other form.
 */
export async function resetSuperAdminPassword(userId, password, context) {
  const passwordHash = await hashPassword(password);
  return getPrisma().$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true } });
    if (user?.role !== 'SUPER_ADMIN') throw new NotASuperAdminError();
    // Role checked again in the write itself: only a SUPER_ADMIN row can change.
    const { count } = await tx.user.updateMany({ where: { id: userId, role: 'SUPER_ADMIN' }, data: { passwordHash } });
    if (count !== 1) throw new NotASuperAdminError();
    const sessionsEnded = (await tx.session.deleteMany({ where: { userId } })).count;
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.SUPER_ADMIN_PASSWORD_RESET,
      actor: { id: null, name: CLI_ACTOR_NAME, role: null },
      target: { type: 'user', id: user.id, name: user.name },
      description:
        `Super Admin password reset from the command line (${context.tool}) on host "${context.host}" ` +
        `by operating-system user "${context.osUser}". ${sessionsEnded === 1 ? '1 session was' : `${sessionsEnded} sessions were`} ended.`,
    });
    return { sessionsEnded };
  });
}

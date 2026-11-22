import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { examNameKey } from './examInput.js';

/*
 * Examination rooms (docs/business-rules.md → Examinations → Rooms): separate from classrooms, with a
 * name and a default capacity only (no location). A Manager manages their branch's rooms; the School
 * Owner any branch's. Never deleted: deactivated. Names are unique per branch regardless of
 * capitalization (409 NAME_TAKEN).
 */

const toRoom = (r) => ({
  id: r.id,
  name: r.name,
  defaultCapacity: r.defaultCapacity,
  status: r.status.toLowerCase(),
  branch: { id: r.branch.id, name: r.branch.name, code: r.branch.code },
});
const include = { branch: { select: { id: true, name: true, code: true } } };
const nameTaken = () => conflict('NAME_TAKEN', 'This branch already has a room with this name.', { name: 'This branch already has a room with this name.' });
const isUnique = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Rooms of the Manager's branch, or (School Owner) of one branch or every branch: { items, totals }. */
export async function listRooms(scope, { status, branch, q }) {
  const where = {
    schoolId: scope.school.id,
    ...(scope.branch ? { branchId: scope.branch.id } : branch && { branchId: branch }),
    ...(status === 'all' ? {} : { status: status === 'inactive' ? 'INACTIVE' : 'ACTIVE' }),
    ...(q && { name: { contains: q, mode: 'insensitive' } }),
  };
  const rows = await getPrisma().examRoom.findMany({ where, include, orderBy: [{ branch: { name: 'asc' } }, { nameKey: 'asc' }] });
  const active = rows.filter((r) => r.status === 'ACTIVE');
  return { items: rows.map(toRoom), totals: { rooms: active.length, seats: active.reduce((n, r) => n + r.defaultCapacity, 0) } };
}

async function findRoom(client, scope, id) {
  const row = isUuid(id) ? await client.examRoom.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, include }) : null;
  if (!row) throw notFound('Room not found.');
  return row;
}

/** Locks the school (Owner) or the Manager's school and branch for a write. */
async function lockFor(tx, scope, branchId) {
  if (scope.branch) return lockOperatingBranch(tx, scope, 'examination rooms');
  await lockActiveSchool(tx, scope.school);
  const branch = await tx.branch.findFirst({ where: { id: branchId, schoolId: scope.school.id }, select: { id: true, name: true, status: true } });
  if (!branch) throw notFound('Branch not found.');
  return branch;
}

const audit = (tx, scope, user, req, action, room, description, fields) =>
  recordAuditEvent({
    client: tx,
    action,
    actor: { id: user.id, name: user.name, role: user.role },
    target: { type: 'exam_room', id: room.id, name: `${room.name} (${room.branch?.name ?? ''})` },
    schoolId: scope.school.id,
    description,
    change: { fields },
    req,
  });

export async function createRoom(scope, values, user, req) {
  try {
    const id = await getPrisma().$transaction(async (tx) => {
      const branchId = scope.branch?.id ?? values.branch;
      await lockFor(tx, scope, branchId);
      const row = await tx.examRoom.create({
        data: { schoolId: scope.school.id, branchId, name: values.name, nameKey: examNameKey(values.name), defaultCapacity: values.defaultCapacity },
        include,
      });
      await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_ROOM_CREATED, row, `Examination room ${row.name} added to ${row.branch.name} (${row.defaultCapacity} seats).`, [
        { field: 'Default capacity', from: null, to: String(row.defaultCapacity) },
      ]);
      return row.id;
    });
    return toRoom(await findRoom(getPrisma(), scope, id));
  } catch (error) {
    if (isUnique(error)) throw nameTaken();
    throw error;
  }
}

export async function updateRoom(scope, id, values, user, req) {
  try {
    await getPrisma().$transaction(async (tx) => {
      const row = await findRoom(tx, scope, id);
      await lockFor(tx, scope, row.branchId);
      const fields = [];
      const data = {};
      if (values.name !== undefined && values.name !== row.name) {
        fields.push({ field: 'Room', from: row.name, to: values.name });
        Object.assign(data, { name: values.name, nameKey: examNameKey(values.name) });
      }
      if (values.defaultCapacity !== undefined && values.defaultCapacity !== row.defaultCapacity) {
        fields.push({ field: 'Default capacity', from: String(row.defaultCapacity), to: String(values.defaultCapacity) });
        data.defaultCapacity = values.defaultCapacity;
      }
      if (!fields.length) return;
      await tx.examRoom.update({ where: { id: row.id }, data });
      await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_ROOM_UPDATED, { ...row, name: values.name ?? row.name }, `Examination room ${values.name ?? row.name} updated.`, fields);
    });
  } catch (error) {
    if (isUnique(error)) throw nameTaken();
    throw error;
  }
  return toRoom(await findRoom(getPrisma(), scope, id));
}

export async function setRoomActive(scope, id, active, user, req) {
  await getPrisma().$transaction(async (tx) => {
    const row = await findRoom(tx, scope, id);
    await lockFor(tx, scope, row.branchId);
    if ((row.status === 'ACTIVE') === active) return;
    await tx.examRoom.update({ where: { id: row.id }, data: { status: active ? 'ACTIVE' : 'INACTIVE', deactivatedAt: active ? null : new Date() } });
    await audit(tx, scope, user, req, active ? AUDIT_ACTIONS.EXAM_ROOM_REACTIVATED : AUDIT_ACTIONS.EXAM_ROOM_DEACTIVATED, row, `Examination room ${row.name} ${active ? 'reactivated' : 'deactivated'}.`, [
      { field: 'Status', from: active ? 'Inactive' : 'Active', to: active ? 'Active' : 'Inactive' },
    ]);
  });
  return toRoom(await findRoom(getPrisma(), scope, id));
}

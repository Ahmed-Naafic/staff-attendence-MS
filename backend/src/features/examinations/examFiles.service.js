import { badRequest, conflict, forbidden, HttpError, notFound, tooManyRequests } from '../../common/httpError.js';
import { FILE_TYPES, readFileDescriptor } from '../../common/storage/fileTypes.js';
import { newObjectKey } from '../../common/storage/storageKeys.js';
import { assertStorageReady, createDownloadUrl, createUploadUrl, maxFileBytes, storageBucket, storageConfigured, tryDeleteObject, verifyUploadedObject } from '../../common/storage/storageService.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { findExam } from './examinations.service.js';

/*
 * Paper files (docs/business-rules.md → Examinations → Paper files; docs/storage/supabase-storage.md):
 * question papers, marking schemes and other files of a paper, kept in the private Supabase bucket
 * through the shared storage service (common/storage/). Metadata lives here, in Neon.
 *
 *   Upload     the server records the file (PENDING) under a key it generates
 *              (schools/<school>/examinations/papers|attachments/<id>.<ext>) and hands out a one-time
 *              signed upload URL for that key only; the browser sends the bytes there; on confirm the
 *              server checks the stored size and the file's signature and marks it READY (or REJECTED,
 *              deleting the bytes). Confirming twice is harmless.
 *   Replace    an upload may name a READY file it replaces: the old file stays READY until the new one
 *              is confirmed, then both change in one transaction (old → REPLACED) and the old bytes
 *              are deleted afterwards.
 *   Download   a signed URL valid for two minutes (save or view); every download is audited — question
 *              papers are confidential until the paper is sat.
 *   Remove     the record is marked REMOVED (kept, with who and when), then the bytes are deleted.
 * Deleting bytes happens after the database commit; when it fails, objectDeletedAt stays empty and
 * storage maintenance (sweepExamPaperFiles) retries. Uploads never confirmed are cleared the same way.
 *
 * Who (EduTrack decides; the storage key bypasses Supabase RLS): the School Owner for every
 * examination of the school; a Manager for their branch's own examinations, and downloads of
 * school-wide ones (to print them). Other roles never reach these routes. Without storage: 503.
 */

export const FILE_KINDS = ['question_paper', 'marking_scheme', 'other'];
const ALLOWED = ['pdf', 'doc', 'docx', 'png', 'jpg'];
const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';
const DOWNLOAD_SECONDS = 120;
const PENDING_LIMIT = 10; // unconfirmed uploads per paper within PENDING_WINDOW_MS
const PENDING_WINDOW_MS = 2 * 60 * 60 * 1000;
export const STALE_PENDING_MS = 24 * 60 * 60 * 1000; // signed upload URLs last 2 hours
const SHOWN = ['READY', 'REPLACED', 'REMOVED'];
const TX = { timeout: 30000, maxWait: 10000 };
const areaOf = (kind) => (kind === 'QUESTION_PAPER' ? 'examPapers' : 'examAttachments');

const toFile = (f) => ({
  id: f.id,
  kind: f.kind.toLowerCase(),
  fileName: f.fileName,
  contentType: f.contentType,
  extension: f.extension,
  type: FILE_TYPES[f.extension]?.label ?? f.extension.toUpperCase(),
  size: f.size,
  status: f.status.toLowerCase(),
  uploadedBy: f.uploadedByName ?? null,
  createdAt: f.createdAt.toISOString(),
  confirmedAt: f.confirmedAt?.toISOString() ?? null,
  removedAt: f.removedAt?.toISOString() ?? null,
  removedBy: f.removedByName ?? null,
  replacedBy: f.replacedById ?? null,
});

/** The paper (of an examination the scope sees) and whether the scope may change its files. */
async function paperOf(client, scope, paperId) {
  const paper = isUuid(paperId) ? await client.examPaper.findFirst({ where: { id: paperId, schoolId: scope.school.id }, include: { subject: { select: { name: true } }, class: { select: { name: true } } } }) : null;
  if (!paper) throw notFound('Paper not found.');
  const exam = await findExam(client, scope, paper.examinationId);
  return { paper, exam, canChange: exam.status !== 'CANCELLED' && (!scope.branch || exam.branchId === scope.branch.id) };
}

const assertCanChange = ({ exam, canChange }) => {
  if (!canChange) throw forbidden(exam.status === 'CANCELLED' ? 'This examination was cancelled.' : 'The School Owner manages the files of school-wide examinations.');
};
const lockScope = (tx, scope) => (scope.branch ? lockOperatingBranch(tx, scope, 'examination files') : lockActiveSchool(tx, scope.school));
const label = (paper) => `${paper.subject.name} · ${paper.class.name}`;
const objectOf = (scope, f) => ({ schoolId: scope.school.id, key: f.storageKey, bucket: f.bucket });

/** Audit entry: never the signed URL or the storage key — ids, names and sizes only. */
const audit = (tx, scope, user, req, action, exam, paper, file, description, extra = {}, result = 'SUCCESS') =>
  recordAuditEvent({
    client: tx,
    action,
    result,
    actor: { id: user.id, name: user.name, role: user.role },
    target: { type: 'examination', id: exam.id, name: exam.name },
    schoolId: scope.school.id,
    description,
    change: { fields: ['files'], paper: label(paper), paperId: paper.id, branchId: file.branchId ?? null, fileId: file.id, file: file.fileName, kind: file.kind.toLowerCase(), type: file.extension, size: file.size, ...extra },
    req,
  });

async function fileOf(client, paper, fileId) {
  const file = isUuid(fileId) ? await client.examPaperFile.findFirst({ where: { id: fileId, paperId: paper.id } }) : null;
  if (!file) throw notFound('File not found.');
  return file;
}

/** Deletes a record's bytes after the database says so; on failure maintenance retries. */
async function purge(scope, file) {
  if (await tryDeleteObject(objectOf(scope, file))) await getPrisma().examPaperFile.update({ where: { id: file.id }, data: { objectDeletedAt: new Date() } });
}

/** A paper's files (removed and replaced ones too, for the record). */
export async function listPaperFiles(scope, paperId) {
  const prisma = getPrisma();
  const { paper, canChange } = await paperOf(prisma, scope, paperId);
  const files = await prisma.examPaperFile.findMany({ where: { paperId: paper.id, status: { in: SHOWN } }, orderBy: { createdAt: 'desc' } });
  return {
    configured: storageConfigured(),
    canChange,
    maxBytes: maxFileBytes(),
    accept: ACCEPT,
    allowed: ALLOWED.map((ext) => FILE_TYPES[ext].label),
    downloadSeconds: DOWNLOAD_SECONDS,
    files: files.map(toFile),
  };
}

/** Starts an upload (or a replacement): { file (pending), upload: { url, method, headers } }. */
export async function startPaperUpload(scope, paperId, { kind, fileName, type, size, replaces }, user) {
  if (!storageConfigured()) throw new HttpError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not set up yet. Ask EduTrack support to connect it.');
  const prisma = getPrisma();
  const found = await paperOf(prisma, scope, paperId);
  assertCanChange(found);
  const { paper, exam } = found;
  let fileKind = kind?.toUpperCase();
  if (replaces) {
    const target = await fileOf(prisma, paper, replaces);
    if (target.status !== 'READY') throw conflict('FILE_NOT_READY', 'Only a file that is available can be replaced.');
    fileKind = target.kind;
  }
  const recent = await prisma.examPaperFile.count({ where: { paperId: paper.id, status: 'PENDING', createdAt: { gt: new Date(Date.now() - PENDING_WINDOW_MS) } } });
  if (recent >= PENDING_LIMIT) throw tooManyRequests('Too many uploads of this paper are unfinished. Wait a moment and try again.', 60);
  const bucket = storageBucket();
  await assertStorageReady(bucket);
  const { fileId, key } = newObjectKey(areaOf(fileKind), { schoolId: scope.school.id, ext: type.ext });
  const file = await prisma.examPaperFile.create({
    data: { id: fileId, schoolId: scope.school.id, branchId: exam.branchId ?? null, paperId: paper.id, kind: fileKind, fileName, contentType: type.mime, extension: type.ext, size, bucket, storageKey: key, replacesId: replaces ?? null, uploadedById: user.id, uploadedByName: user.name },
  });
  try {
    const upload = await createUploadUrl({ schoolId: scope.school.id, key, contentType: type.mime, bucket });
    return { file: toFile(file), upload };
  } catch (error) {
    // Nothing was stored: close the record so it is never offered or swept again.
    await prisma.examPaperFile.update({ where: { id: file.id }, data: { status: 'ABANDONED', objectDeletedAt: new Date() } });
    throw error;
  }
}

const REJECTED_TEXT = {
  size: 'The stored file does not have the expected size. Upload it again.',
  content: 'The file content does not match its type. Only real PDF, Word or image files are accepted.',
};

/** Confirms an upload once the stored bytes check out: the file is ready (and replaces its target). */
export async function confirmPaperUpload(scope, paperId, fileId, user, req) {
  const prisma = getPrisma();
  const found = await paperOf(prisma, scope, paperId);
  assertCanChange(found);
  const { paper, exam } = found;
  const file = await fileOf(prisma, paper, fileId);
  if (file.status === 'READY') return { file: toFile(file) }; // a repeated confirm
  if (file.status !== 'PENDING') throw conflict('NOT_PENDING', 'This upload is no longer open. Upload the file again.');
  const check = await verifyUploadedObject({ ...objectOf(scope, file), size: file.size, ext: file.extension });
  if (!check.ok && check.reason === 'missing') throw conflict('UPLOAD_INCOMPLETE', 'The file has not arrived in storage. Upload it again.');
  if (!check.ok) {
    const rejected = await prisma.$transaction(async (tx) => {
      const n = await tx.examPaperFile.updateMany({ where: { id: file.id, status: 'PENDING' }, data: { status: 'REJECTED', statusReason: check.reason } });
      if (n.count) await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_REJECTED, exam, paper, file, `Rejected the upload ${file.fileName} for ${label(paper)} in ${exam.name} (${check.reason}).`, { reason: check.reason }, 'FAILURE');
      return n.count;
    }, TX);
    if (rejected) await purge(scope, file);
    throw new HttpError(422, 'UPLOAD_REJECTED', REJECTED_TEXT[check.reason]);
  }
  let replaced = null;
  let ready;
  try {
    ready = await prisma.$transaction(async (tx) => {
      await lockScope(tx, scope);
      const now = new Date();
      const n = await tx.examPaperFile.updateMany({ where: { id: file.id, status: 'PENDING' }, data: { status: 'READY', confirmedAt: now } });
      if (!n.count) return null; // confirmed by a concurrent request
      if (file.replacesId) {
        replaced = await tx.examPaperFile.findFirst({ where: { id: file.replacesId, paperId: paper.id, status: 'READY' } });
        if (!replaced) throw conflict('REPLACE_TARGET_CHANGED', 'The file you were replacing was changed or removed meanwhile. Your upload was discarded.');
        await tx.examPaperFile.update({ where: { id: replaced.id }, data: { status: 'REPLACED', replacedById: file.id, removedAt: now, removedByName: user.name } });
        await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_REPLACED, exam, paper, file, `Replaced ${replaced.fileName} with ${file.fileName} for ${label(paper)} in ${exam.name}.`, { replacedFileId: replaced.id, replacedFile: replaced.fileName });
      } else {
        await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_UPLOADED, exam, paper, file, `Uploaded ${file.fileName} for ${label(paper)} in ${exam.name}.`);
      }
      return tx.examPaperFile.findUnique({ where: { id: file.id } });
    }, TX);
  } catch (error) {
    if (error.code === 'REPLACE_TARGET_CHANGED') {
      await prisma.examPaperFile.updateMany({ where: { id: file.id, status: 'PENDING' }, data: { status: 'ABANDONED' } });
      await purge(scope, file);
    }
    throw error;
  }
  if (!ready) return { file: toFile(await prisma.examPaperFile.findUnique({ where: { id: file.id } })) };
  if (replaced) await purge(scope, replaced);
  return { file: toFile(ready) };
}

/** A short-lived link for a ready file ({ url, expiresAt }); the access is audited. */
export async function paperFileDownload(scope, paperId, fileId, user, req, { mode = 'download' } = {}) {
  const prisma = getPrisma();
  const { paper, exam } = await paperOf(prisma, scope, paperId);
  const file = await fileOf(prisma, paper, fileId);
  if (file.status !== 'READY') throw conflict('FILE_NOT_READY', 'This file is not available.');
  const verb = mode === 'view' ? 'Viewed' : 'Downloaded';
  let link;
  try {
    link = await createDownloadUrl({ ...objectOf(scope, file), seconds: DOWNLOAD_SECONDS, fileName: mode === 'view' ? undefined : file.fileName });
  } catch (error) {
    if (error.code === 'FILE_MISSING') {
      console.error(`[storage] paper file ${file.id} is READY but its object is missing.`);
      await audit(prisma, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_DOWNLOADED, exam, paper, file, `Could not open ${file.fileName} of ${label(paper)} in ${exam.name}: the stored copy is missing.`, { mode, reason: 'missing' }, 'FAILURE');
      throw new HttpError(404, 'FILE_MISSING', 'The stored copy of this file is missing. Upload it again.');
    }
    throw error;
  }
  await audit(prisma, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_DOWNLOADED, exam, paper, file, `${verb} ${file.fileName} of ${label(paper)} in ${exam.name}.`, { mode });
  return { ...link, fileName: file.fileName };
}

/** Removes a file: the record is kept (REMOVED), then the stored bytes are deleted. */
export async function removePaperFile(scope, paperId, fileId, user, req) {
  const prisma = getPrisma();
  const found = await paperOf(prisma, scope, paperId);
  assertCanChange(found);
  const { paper, exam } = found;
  const file = await fileOf(prisma, paper, fileId);
  if (file.status !== 'READY') throw conflict('FILE_REMOVED', 'This file was removed or replaced already.');
  const row = await prisma.$transaction(async (tx) => {
    await lockScope(tx, scope);
    const n = await tx.examPaperFile.updateMany({ where: { id: file.id, status: 'READY' }, data: { status: 'REMOVED', removedAt: new Date(), removedByName: user.name } });
    if (!n.count) throw conflict('FILE_REMOVED', 'This file was removed or replaced already.');
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_REMOVED, exam, paper, file, `Removed ${file.fileName} of ${label(paper)} in ${exam.name}.`);
    return tx.examPaperFile.findUnique({ where: { id: file.id } });
  }, TX);
  await purge(scope, row);
  return { file: toFile(row) };
}

/**
 * Storage maintenance for paper files (features/storage/storageMaintenance.js, daily job):
 * uploads never confirmed within a day become ABANDONED, and records that are no longer READY but
 * may still have bytes in storage get them deleted. Idempotent; at most `limit` records a run.
 */
export async function sweepExamPaperFiles({ now = new Date(), limit = 200 } = {}) {
  if (!storageConfigured()) return { skipped: 'storage not configured' };
  const prisma = getPrisma();
  const stale = await prisma.examPaperFile.findMany({ where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) } }, take: limit });
  for (const f of stale) await prisma.examPaperFile.updateMany({ where: { id: f.id, status: 'PENDING' }, data: { status: 'ABANDONED' } });
  const leftovers = await prisma.examPaperFile.findMany({ where: { status: { in: ['REMOVED', 'REPLACED', 'REJECTED', 'ABANDONED'] }, objectDeletedAt: null }, take: limit, orderBy: { createdAt: 'asc' } });
  let deleted = 0;
  for (const f of leftovers) {
    if (await tryDeleteObject({ schoolId: f.schoolId, key: f.storageKey, bucket: f.bucket })) {
      await prisma.examPaperFile.update({ where: { id: f.id }, data: { objectDeletedAt: new Date() } });
      deleted += 1;
    }
  }
  return { abandoned: stale.length, deleted, pending: leftovers.length - deleted };
}

/** { kind, fileName, contentType?, size, replaces? } — the type comes from the name and is checked again on confirm. */
export function readPaperUpload(body) {
  const unknown = Object.keys(body).filter((k) => !['kind', 'fileName', 'contentType', 'size', 'replaces'].includes(k));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  const errors = {};
  if (body.replaces !== undefined && !isUuid(body.replaces)) errors.replaces = 'Not a file of this paper.';
  if (body.replaces === undefined && !FILE_KINDS.includes(body.kind)) errors.kind = 'Question paper, marking scheme or other.';
  if (body.replaces !== undefined && body.kind !== undefined && !FILE_KINDS.includes(body.kind)) errors.kind = 'Question paper, marking scheme or other.';
  let descriptor = null;
  try {
    descriptor = readFileDescriptor(body, { allowed: ALLOWED, maxBytes: maxFileBytes() });
  } catch (error) {
    Object.assign(errors, error.details);
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { kind: body.kind, ...descriptor, replaces: body.replaces };
}

/** { mode: 'download' | 'view' } (default download). */
export function readDownloadRequest(body = {}) {
  const unknown = Object.keys(body).filter((k) => k !== 'mode');
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  if (body.mode !== undefined && !['download', 'view'].includes(body.mode)) throw badRequest('Check the highlighted fields.', { mode: 'Download or view.' });
  return { mode: body.mode ?? 'download' };
}

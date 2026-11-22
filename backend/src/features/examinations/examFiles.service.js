import { randomUUID } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { ensureBucket, NOT_CONFIGURED, objectSize, removeObject, signedDownloadUrl, signedUploadUrl, storageConfigured } from '../../common/supabaseStorage.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { findExam } from './examinations.service.js';

/*
 * Paper files (docs/business-rules.md → Examinations → Paper files): question papers, marking schemes
 * and other files of a paper, kept in a private Supabase Storage bucket (common/supabaseStorage.js).
 *
 *   Upload     the server records the file (pending) and gives a one-time signed upload URL; the
 *              browser sends the file there; the server checks the stored size and marks it ready.
 *   Download   a signed URL valid for two minutes; every download is audited (question papers are
 *              confidential until the paper is sat).
 *   Remove     the stored file is deleted; the record stays (who removed it and when).
 * Who: the School Owner; a Manager for their branch's own examinations (and downloads for school-wide
 * ones, to print them). PDF, Word and images up to 20 MB. Without storage set up: 503.
 */

export const FILE_KINDS = ['question_paper', 'marking_scheme', 'other'];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const FILE_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};
const DOWNLOAD_SECONDS = 120;
const TX = { timeout: 30000, maxWait: 10000 };

const toFile = (f) => ({
  id: f.id,
  kind: f.kind.toLowerCase(),
  fileName: f.fileName,
  contentType: f.contentType,
  size: f.size,
  status: f.status.toLowerCase(),
  uploadedBy: f.uploadedByName ?? null,
  createdAt: f.createdAt.toISOString(),
  confirmedAt: f.confirmedAt?.toISOString() ?? null,
  removedAt: f.removedAt?.toISOString() ?? null,
  removedBy: f.removedByName ?? null,
});

/** The paper (of an examination the scope sees) and whether the scope may change its files. */
async function paperOf(client, scope, paperId) {
  const paper = isUuid(paperId) ? await client.examPaper.findFirst({ where: { id: paperId, schoolId: scope.school.id }, include: { subject: { select: { name: true } }, class: { select: { name: true } } } }) : null;
  if (!paper) throw notFound('Paper not found.');
  const exam = await findExam(client, scope, paper.examinationId);
  return { paper, exam, canChange: exam.status !== 'CANCELLED' && (!scope.branch || exam.branchId === scope.branch.id) };
}

const label = (paper) => `${paper.subject.name} · ${paper.class.name}`;
const audit = (tx, scope, user, req, action, exam, paper, file, description) =>
  recordAuditEvent({ client: tx, action, actor: { id: user.id, name: user.name, role: user.role }, target: { type: 'examination', id: exam.id, name: exam.name }, schoolId: scope.school.id, description, change: { fields: ['files'], paper: label(paper), file: file.fileName, kind: file.kind.toLowerCase(), size: file.size }, req });

/** A paper's files (removed ones too, for the record): { configured, canChange, files }. */
export async function listPaperFiles(scope, paperId) {
  const prisma = getPrisma();
  const { paper, canChange } = await paperOf(prisma, scope, paperId);
  const files = await prisma.examPaperFile.findMany({ where: { paperId: paper.id, status: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' } });
  return { configured: storageConfigured(), canChange, maxBytes: MAX_FILE_BYTES, types: Object.keys(FILE_TYPES), files: files.map(toFile) };
}

/** Starts an upload: { file (pending), upload: { url, method, headers } }. */
export async function startPaperUpload(scope, paperId, { kind, fileName, contentType, size }, user) {
  if (!storageConfigured()) throw NOT_CONFIGURED();
  const prisma = getPrisma();
  const { paper, exam, canChange } = await paperOf(prisma, scope, paperId);
  if (!canChange) throw forbidden(exam.status === 'CANCELLED' ? 'This examination was cancelled.' : 'The School Owner manages the files of school-wide examinations.');
  await ensureBucket({ fileSizeLimit: MAX_FILE_BYTES, mimeTypes: Object.keys(FILE_TYPES) });
  const id = randomUUID();
  const storageKey = `${scope.school.id}/${exam.id}/${paper.id}/${id}.${FILE_TYPES[contentType]}`;
  const file = await prisma.examPaperFile.create({ data: { id, schoolId: scope.school.id, paperId: paper.id, kind: kind.toUpperCase(), fileName, contentType, size, storageKey, uploadedById: user.id, uploadedByName: user.name } });
  const { url } = await signedUploadUrl(storageKey);
  return { file: toFile(file), upload: { url, method: 'PUT', headers: { 'content-type': contentType, 'x-upsert': 'false' } } };
}

async function fileOf(client, paper, fileId) {
  const file = isUuid(fileId) ? await client.examPaperFile.findFirst({ where: { id: fileId, paperId: paper.id } }) : null;
  if (!file) throw notFound('File not found.');
  return file;
}

/** Confirms an upload once the stored size matches: the file is ready. */
export async function confirmPaperUpload(scope, paperId, fileId, user, req) {
  const prisma = getPrisma();
  const { paper, exam, canChange } = await paperOf(prisma, scope, paperId);
  if (!canChange) throw forbidden('You cannot change the files of this paper.');
  const file = await fileOf(prisma, paper, fileId);
  if (file.status !== 'PENDING') throw conflict('NOT_PENDING', 'This file is already uploaded.');
  const stored = await objectSize(file.storageKey);
  if (stored === null) throw conflict('UPLOAD_INCOMPLETE', 'The file has not arrived in storage. Upload it again.');
  if (stored !== file.size) throw conflict('UPLOAD_INCOMPLETE', 'The stored file is not complete. Upload it again.');
  const ready = await prisma.$transaction(async (tx) => {
    if (scope.branch) await lockOperatingBranch(tx, scope, 'examination files');
    else await lockActiveSchool(tx, scope.school);
    const row = await tx.examPaperFile.update({ where: { id: file.id }, data: { status: 'READY', confirmedAt: new Date() } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_UPLOADED, exam, paper, row, `Uploaded ${row.fileName} for ${label(paper)} in ${exam.name}.`);
    return row;
  }, TX);
  return { file: toFile(ready) };
}

/** A short-lived download link for a ready file; the download is audited. */
export async function paperFileDownload(scope, paperId, fileId, user, req) {
  const prisma = getPrisma();
  const { paper, exam } = await paperOf(prisma, scope, paperId);
  const file = await fileOf(prisma, paper, fileId);
  if (file.status !== 'READY') throw conflict('FILE_NOT_READY', 'This file is not available.');
  const link = await signedDownloadUrl(file.storageKey, DOWNLOAD_SECONDS, file.fileName);
  await audit(prisma, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_DOWNLOADED, exam, paper, file, `Downloaded ${file.fileName} of ${label(paper)} in ${exam.name}.`);
  return link;
}

/** Removes a file: the stored copy is deleted, the record kept. */
export async function removePaperFile(scope, paperId, fileId, user, req) {
  const prisma = getPrisma();
  const { paper, exam, canChange } = await paperOf(prisma, scope, paperId);
  if (!canChange) throw forbidden('You cannot change the files of this paper.');
  const file = await fileOf(prisma, paper, fileId);
  if (file.status === 'REMOVED') throw conflict('FILE_REMOVED', 'This file was removed already.');
  await removeObject(file.storageKey);
  const row = await prisma.$transaction(async (tx) => {
    if (scope.branch) await lockOperatingBranch(tx, scope, 'examination files');
    else await lockActiveSchool(tx, scope.school);
    const updated = await tx.examPaperFile.update({ where: { id: file.id }, data: { status: 'REMOVED', removedAt: new Date(), removedByName: user.name } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_PAPER_FILE_REMOVED, exam, paper, updated, `Removed ${updated.fileName} of ${label(paper)} in ${exam.name}.`);
    return updated;
  }, TX);
  return { file: toFile(row) };
}

/** { kind, fileName (1–120), contentType (allowed), size (1 B – 20 MB) }. */
export function readPaperUpload(body) {
  const errors = {};
  if (!FILE_KINDS.includes(body.kind)) errors.kind = 'Question paper, marking scheme or other.';
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') : '';
  if (!fileName || fileName.length > 120) errors.fileName = 'A file name of at most 120 characters.';
  if (!FILE_TYPES[body.contentType]) errors.contentType = 'PDF, Word or an image (PNG, JPEG).';
  if (!Number.isInteger(body.size) || body.size < 1 || body.size > MAX_FILE_BYTES) errors.size = 'At most 20 MB.';
  const unknown = Object.keys(body).filter((k) => !['kind', 'fileName', 'contentType', 'size'].includes(k));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { kind: body.kind, fileName, contentType: body.contentType, size: body.size };
}

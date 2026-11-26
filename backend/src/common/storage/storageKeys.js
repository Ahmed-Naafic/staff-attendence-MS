import { randomUUID } from 'node:crypto';
import { HttpError } from '../httpError.js';

/*
 * Object keys (paths inside the bucket) — docs/storage/supabase-storage.md → Object keys.
 *
 *   schools/{schoolId}/examinations/papers/{fileId}.{ext}
 *   schools/{schoolId}/examinations/attachments/{fileId}.{ext}
 *   schools/{schoolId}/student-documents/{studentId}/{fileId}.{ext}
 *   schools/{schoolId}/staff-documents/{staffId}/{fileId}.{ext}
 *
 * Every part is a server-side id (UUIDs) or a fixed word; nothing comes from the user, so a key can
 * never escape its school's prefix. Every storage operation re-checks the key against the school
 * that the signed-in account belongs to (`assertKeyOfSchool`) as a second line of defence.
 * "Folders" are only prefixes: nothing has to be created in the dashboard.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT = /^[a-z0-9]{1,8}$/;

/** Where each kind of file lives; `owner` names the record id the path needs (if any). */
export const STORAGE_AREAS = {
  examPapers: { path: () => 'examinations/papers' },
  examAttachments: { path: () => 'examinations/attachments' },
  studentDocuments: { path: (ownerId) => `student-documents/${ownerId}`, owner: 'studentId' },
  staffDocuments: { path: (ownerId) => `staff-documents/${ownerId}`, owner: 'staffId' },
};

const invalid = () => new HttpError(500, 'STORAGE_KEY_INVALID', 'The file location is not valid.');

/** A new object key: { fileId, key }. `ownerId` is required for areas that have an owner record. */
export function newObjectKey(area, { schoolId, ownerId, ext, fileId = randomUUID() }) {
  const def = STORAGE_AREAS[area];
  if (!def || !UUID.test(schoolId ?? '') || !UUID.test(fileId) || !EXT.test(ext ?? '')) throw invalid();
  if (def.owner && !UUID.test(ownerId ?? '')) throw invalid();
  return { fileId, key: `schools/${schoolId.toLowerCase()}/${def.path(ownerId?.toLowerCase())}/${fileId.toLowerCase()}.${ext}` };
}

/**
 * Throws unless `key` is a well-formed key inside `schools/{schoolId}/` (or `{schoolId}/`, the layout
 * of the first paper-file release, kept readable for any record made with it).
 */
export function assertKeyOfSchool(key, schoolId) {
  if (typeof key !== 'string' || !UUID.test(schoolId ?? '')) throw invalid();
  const id = schoolId.toLowerCase();
  const inSchool = key.startsWith(`schools/${id}/`) || key.startsWith(`${id}/`);
  if (!inSchool || key.includes('..') || key.includes('//') || key.endsWith('/') || /[^a-z0-9/._-]/.test(key)) throw invalid();
  return key;
}

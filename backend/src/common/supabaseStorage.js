/*
 * Superseded by the shared storage layer in common/storage/ (docs/storage/supabase-storage.md).
 * Kept only so older imports keep working; new code imports common/storage/storageService.js.
 */
export {
  assertStorageReady,
  createDownloadUrl,
  createUploadUrl,
  deleteObject,
  objectExists,
  setStorageBackend,
  storageConfigured,
  verifyUploadedObject,
} from './storage/storageService.js';

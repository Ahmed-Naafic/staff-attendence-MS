# File storage (Supabase Storage)

EduTrack keeps **files** in Supabase Storage and **everything else** (including every file's metadata)
in PostgreSQL on Neon through Prisma. Supabase is used for storage only: no Supabase database, auth or
realtime. The first user of the storage layer is **examination paper files**. Student and staff
documents can reuse the same layer later.

```
Browser (web app)                 EduTrack API (Express, Vercel)                 Supabase Storage
─────────────────                 ──────────────────────────────                 ────────────────
POST …/files {name,size,kind} ──► auth + RBAC + school/branch scope
                                  validate name/type/size
                                  record PENDING in Neon (key generated)
                                  createSignedUploadUrl(key) ────────────────►  one-time upload URL
◄──────────────── { upload.url } ◄─┘
PUT bytes ─────────────────────────────────────────────────────────────────►  object stored (no overwrite)
POST …/files/:id/confirm ───────► auth + RBAC again
                                  info(key): size ───────────────────────────►
                                  first 16 bytes (signature) ────────────────►
                                  Neon: READY (+ replace) + audit, one transaction
                                  (or REJECTED + delete bytes + audit FAILURE)
POST …/files/:id/download ──────► auth + RBAC, READY only
                                  createSignedUrl(key, 120 s) ───────────────►
                                  audit (no URL in it)
◄──────────── { url, expiresAt }
GET url ───────────────────────────────────────────────────────────────────►  file (until the link expires)
```

## Code map

| Piece | File |
| --- | --- |
| Environment variables | `backend/src/config/env.js` |
| Startup/config check | `backend/src/common/storage/storageConfig.js` (called from `app.js`) |
| Supabase SDK adapter (only place with the SDK) | `backend/src/common/storage/supabaseBackend.js` |
| **Storage service** (what modules call) | `backend/src/common/storage/storageService.js` |
| Object keys + school isolation | `backend/src/common/storage/storageKeys.js` |
| File types, name cleaning, signature checks | `backend/src/common/storage/fileTypes.js` |
| Maintenance (cleanup) | `backend/src/features/storage/storageMaintenance.js` (daily job) |
| Exam paper files (first module) | `backend/src/features/examinations/examFiles.service.js`, routes in `examinations.routes.js` |
| Metadata table | `ExamPaperFile` in `prisma/schema.prisma`, migration `20261126090000_storage_paper_files` |
| Web UI | `apps/web/src/features/examinations/components/PaperFilesModal.jsx`, `data/examApi.js` |

SDK: `@supabase/supabase-js` (pinned to 2.119.0, backend only). It is created with
`persistSession: false`, `autoRefreshToken: false`, a 20-second request timeout, and the secret key.

## Environment variables

Set these in the **backend** environment only: `backend/.env` for production, Vercel → Project →
Settings → Environment Variables, and `backend/.env.dev` if you want storage while developing.

| Variable | Required | Meaning |
| --- | --- | --- |
| `SUPABASE_URL` | for storage | Project URL only, `https://<project-ref>.supabase.co` (no `/storage/v1`) |
| `SUPABASE_SECRET_KEY` | for storage | A **secret** key `sb_secret_…` (Project Settings → API Keys). A legacy `service_role` JWT also works. **Not** the publishable/anon key. |
| `SUPABASE_STORAGE_BUCKET` | no | The existing private bucket. Default `edutrack-files`. |
| `STORAGE_MAX_FILE_MB` | no | Largest accepted file in MB. Default `20` (the examination rule). |
| `STORAGE_REQUIRED` | no | `true` stops the server at startup when storage is missing or wrong. Default: problems are only logged, and file features answer `503 STORAGE_NOT_CONFIGURED`. |

Rules:

- The secret key must **never** reach React/Vite or Expo. Never use a `VITE_` or `EXPO_PUBLIC_` name for it. Never hardcode or commit it (`.env` and `.env.*` are git-ignored).
- At startup the backend checks the configuration and logs **which** variable is wrong and why, never the value. For example: URL without key, a publishable key, an anon JWT, an http URL, a URL with a path, an invalid bucket name, or an invalid size.
- With neither URL nor key set, storage is simply "not set up". The rest of EduTrack works, and the files dialog says so.

## Supabase dashboard: what must be set by hand

EduTrack never creates, deletes or reconfigures buckets. It only checks, and caches for 5 minutes,
that the bucket exists and is **private**. It refuses to work with a public bucket
(`503 STORAGE_BUCKET_PUBLIC`).

In **Storage → Buckets → `edutrack-files` → Edit bucket**:

1. **Public bucket: OFF** (must stay private).
2. **Restrict file size: recommended.** Set it to at least `STORAGE_MAX_FILE_MB` (20 MB). The bucket currently has no limit. The project-wide limit (Storage → Settings) must be at least as large too.
3. **Allowed MIME types: recommended.** `application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, image/png, image/jpeg`. EduTrack already sends exactly these canonical types on upload, so this only adds a second gate.
4. **Policies (RLS on `storage.objects`): add none.** The backend uses the secret key, which bypasses RLS. Browsers never hold a Supabase session. **Do not** add policies that grant `anon` or `authenticated` access "to make uploads work". With no policies, the publishable key cannot read or list anything.

In **Project Settings → API Keys**: create a dedicated secret key for EduTrack (for example
`edutrack-backend`) so it can be rotated or revoked on its own. To rotate: create a new key, update
`SUPABASE_SECRET_KEY` in Vercel and `backend/.env`, redeploy, then delete the old key.

## Why the backend does all authorization

The secret key has elevated privileges. Storage RLS does **not** apply to it, so Supabase will do
whatever the backend asks. Every protection therefore lives in EduTrack, before the storage service is
called:

1. **Authentication**: the existing session cookie (`requireAuth`). No second auth system exists.
2. **Role**: exam file routes exist only under `/api/owner` and `/api/manager`, behind the examinations module switch. Staff, Accountants and anonymous callers never reach them.
3. **School**: the paper is looked up with `schoolId = <signed-in school>`. Another school's ids answer `404`, which does not reveal whether they exist.
4. **Branch**: a Manager sees only school-wide examinations and their own branch's (`findExam` scope). They change files only of their own branch's examinations, and may view or download school-wide ones (to print). Changes lock the operating branch (or the active school for the Owner) in the same transaction.
5. **Record state**: cancelled examinations are read-only. Only `READY` files can be downloaded, replaced or removed.
6. **Key check** (defence in depth): every storage call names the school, and the object key must lie under `schools/<thatSchool>/`. Anything else is refused before Supabase is called (`STORAGE_KEY_INVALID`).

Hiding buttons in the UI is only convenience. The API enforces every rule above.

## Object keys (folders)

```
schools/{schoolId}/examinations/papers/{fileId}.{ext}          question papers
schools/{schoolId}/examinations/attachments/{fileId}.{ext}     marking schemes, other paper files
schools/{schoolId}/student-documents/{studentId}/{fileId}.{ext}   (reserved for later)
schools/{schoolId}/staff-documents/{staffId}/{fileId}.{ext}       (reserved for later)
```

- Every part is a server-side UUID or a fixed word, built by `newObjectKey(area, …)`. The client never sends a path, and an unknown field such as `storageKey` is rejected.
- `{ext}` is decided by the server from the validated type, never copied from the name.
- Folders are just prefixes. Nothing has to be created in the dashboard.
- The branch is stored as metadata (`ExamPaperFile.branchId`), not in the key, so a key never changes when records move.
- The first release used `{schoolId}/{examId}/{paperId}/{id}.{ext}`. Such keys stay readable (no such files exist in production, because storage was never configured there).

## Validation

Centralized in `fileTypes.js`. Each module passes its allowed list and the size limit.

- **Type by extension** of the cleaned file name. Examination files allow `pdf, doc, docx` (the required set) plus `png, jpg/jpeg`. The image types were already part of the shipped examination rules, for photographed or scanned handwritten papers.
- **Browser Content-Type is a hint.** When it is specific, it must agree with the extension. Empty or `application/octet-stream` is accepted. The stored content type is always the server's canonical one.
- **Size**: an integer from 1 byte to `STORAGE_MAX_FILE_MB`. Empty files are refused.
- **Name**: path parts, control and reserved characters, and leading dots are removed. At most 120 characters, keeping the extension. It is used only for display and as the download name.
- **Content**: after upload, the stored size must equal the declared size, and the first bytes must match the type's signature: `%PDF-`, OLE2 for `.doc`, ZIP for `.docx`, PNG, JPEG. A renamed executable, HTML file or script is rejected and deleted. Limitation: OLE2 and ZIP signatures are shared with other Office and ZIP formats, and the extension narrows it down. There is no antivirus scan.

## Upload, replace, download, remove

| Step | Endpoint (prefix `/api/owner/exams` or `/api/manager/exams`) |
| --- | --- |
| List | `GET /papers/:paperId/files` → `{ configured, canChange, maxBytes, accept, allowed, downloadSeconds, files[] }` |
| Start upload | `POST /papers/:paperId/files` `{ kind, fileName, contentType?, size }` → `201 { file, upload: { url, method: 'PUT', headers } }` |
| Start replacement | `POST /papers/:paperId/files` `{ replaces: <fileId>, fileName, contentType?, size }` (keeps the old file's kind) |
| Confirm | `POST /papers/:paperId/files/:fileId/confirm` → `{ file }` (`409 UPLOAD_INCOMPLETE`, `422 UPLOAD_REJECTED`, `409 REPLACE_TARGET_CHANGED`) |
| Link | `POST /papers/:paperId/files/:fileId/download` `{ mode?: 'download' \| 'view' }` → `{ url, expiresAt, fileName }` |
| Remove | `POST /papers/:paperId/files/:fileId/remove` → `{ file }` |

Responses never contain the secret key, the bucket or the object key. The upload URL is one-time,
works for that one key only, and cannot overwrite an existing object.

**Why the browser uploads to a signed URL instead of through the API:** the API runs on Vercel
Functions, which limit request bodies to about 4.5 MB, and examination files may be up to 20 MB. The
signed upload URL holds no credentials and is limited to one new object. The server still decides
everything: the key, the type, and whether the bytes are accepted. The browser never uses a Supabase
client or key. For small files the server already holds (generated documents, imports),
`uploadBuffer()` uploads directly from the backend.

**Upload progress** is shown with `XMLHttpRequest` progress events, and the upload can be cancelled.

**Signed URL security:** download and view links live for **120 seconds**. They are created only after
authorization, returned once, and never stored in Neon, written to logs or put in audit entries. The UI
asks for a new link on every click, so an expired link is never reused. If a link expires before the
browser opens it, clicking again gets a new one.

## Metadata (Neon)

`ExamPaperFile` holds: `schoolId`, `branchId`, `paperId` (the related record; the module is implied by
the table), `kind`, original `fileName`, server `contentType` and `extension`, `size`, `bucket`,
`storageKey` (unique), `status` (`PENDING → READY → REPLACED/REMOVED`, or `REJECTED`/`ABANDONED`),
`statusReason`, `replacesId`/`replacedById`, `uploadedById`/`uploadedByName`, `createdAt`,
`confirmedAt`, `removedAt`/`removedByName`, and `objectDeletedAt`. Records are never deleted: history
stays.

Migration `20261126090000_storage_paper_files` is additive. It adds enum values and columns, and fills
existing rows from their key and examination. It has been applied to the **dev** branch only.
Production needs `npm run prisma:deploy` with approval before this code is deployed.

## Consistency between Neon and Supabase

There is no transaction across the two systems. Each step is ordered so that a failure at any point
leaves a state that is safe and can be repaired:

| Failure | Result | Repair |
| --- | --- | --- |
| Storage fails before an upload URL is issued | Record closed as `ABANDONED` (nothing stored) | none needed |
| Browser upload fails or the tab closes | Record stays `PENDING` (hidden), maybe with bytes stored | Maintenance after 24 h → `ABANDONED`, bytes deleted |
| Bytes wrong (size or signature) | `REJECTED` + audit `FAILURE`, bytes deleted | Failed delete retried by maintenance |
| Neon fails while confirming | Still `PENDING`; confirm can be repeated (idempotent) | Retry, or maintenance |
| Duplicate confirm or double click | Second confirm returns the same ready file; the state change uses `updateMany … where status = PENDING` | none |
| Two replacements of one file | First wins; second → `409 REPLACE_TARGET_CHANGED`, its bytes deleted | none |
| Replace | Old file stays `READY` until the new one is verified, then both change in **one** Neon transaction, then the old bytes are deleted | Failed delete retried by maintenance |
| Remove | Neon first (`REMOVED` + audit), then bytes deleted | `objectDeletedAt` stays empty → maintenance retries |
| Bytes missing for a READY record | `404 FILE_MISSING`, audit `FAILURE`, server log | Upload again (replace) |

- Metadata never claims a file is available before its bytes have been verified.
- Bytes are never deleted while a record still offers them.
- Storage calls that are safe to repeat (bucket check, info, read, signing, delete) get **one retry** after a network or server error. Uploads are never retried by the server, and they cannot overwrite.
- At most 10 unfinished uploads per paper within 2 hours (`429`).
- **Maintenance** runs in the daily job (`/api/internal/jobs/notifications`, task `storage`). It is idempotent and handles up to 200 records per run.

## Audit

Through the existing audit log (`recordAuditEvent`), with actor, school, examination, and in `change`
the paper, `paperId`, `branchId`, `fileId`, file name, kind, type and size:

`EXAM_PAPER_FILE_UPLOADED`, `EXAM_PAPER_FILE_REPLACED`, `EXAM_PAPER_FILE_DOWNLOADED` (every download
or view, `mode` recorded; a missing object is recorded with result `FAILURE`),
`EXAM_PAPER_FILE_REMOVED`, `EXAM_PAPER_FILE_REJECTED` (result `FAILURE`).

Audit entries never contain the secret key, signed URLs, object keys or file contents. Refused access
attempts (403/404) are not audited, which matches the rest of EduTrack.

## Reusing the storage service (students, staff, future modules)

1. **Metadata table** in the module (for example `StudentDocument`), with the same columns as `ExamPaperFile`: `schoolId`, `branchId`, owner id, `fileName`, `contentType`, `extension`, `size`, `bucket`, `storageKey @unique`, `status`, uploader, timestamps, `objectDeletedAt`.
2. **Authorize first** with the module's existing scope helpers: school, branch, role, and access to the related record.
3. **Validate** with `readFileDescriptor(body, { allowed: [...], maxBytes: maxFileBytes() })`.
4. **Key** with `newObjectKey('studentDocuments', { schoolId, ownerId: studentId, ext: type.ext })`.
5. **Upload**: create the `PENDING` record, then `createUploadUrl({ schoolId, key, contentType: type.mime })`. On confirm, call `verifyUploadedObject({ schoolId, key, size, ext })`, then mark it `READY` and audit in one transaction.
6. **Read**: `createDownloadUrl({ schoolId, key, seconds, fileName })`, audited if the module's documents are sensitive.
7. **Remove**: update Neon first, then `tryDeleteObject(...)`, setting `objectDeletedAt` when it succeeds.
8. **Sweeper**: add the module's sweep function to `SWEEPERS` in `features/storage/storageMaintenance.js`.

Add the module's own audit actions to `auditActions.js` (action, filter list, module list, label). No
new bucket is needed.

## Tests

```bash
npm run test:api                                   # whole backend suite (Neon dev branch)
cd backend
node --env-file=.env.dev --test test/storage.test.js          # storage layer only, no database
node --env-file=.env.dev --test test/examPaperFiles.test.js   # exam paper files on the dev branch
```

Supabase is mocked. `storage.test.js` drives the real SDK adapter through a fake `fetch`, and
`examPaperFiles.test.js` uses `setStorageBackend()` with an in-memory store. No test needs a Supabase
project or credentials.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Files dialog says "File storage is not set up yet"; `503 STORAGE_NOT_CONFIGURED` | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` missing or invalid. The server log line `[storage] …` at startup says which. On Vercel, set the variables and redeploy. |
| `503 STORAGE_BUCKET_MISSING` | `SUPABASE_STORAGE_BUCKET` does not match an existing bucket (check spelling, default `edutrack-files`). EduTrack never creates it. |
| `503 STORAGE_BUCKET_PUBLIC` | The bucket was made public. Turn **Public bucket** off. Checks are cached for 5 minutes. |
| `503 STORAGE_ACCESS_DENIED` | The key was refused (revoked, wrong project, or a publishable key). Create a new secret key. |
| `502 STORAGE_ERROR` | Supabase unreachable or erroring after one retry. Check status.supabase.com, then try again. |
| Browser upload fails (CORS or 4xx) | The signed upload URL is single-use and expires after 2 hours. Start the upload again. A bucket MIME or size restriction stricter than EduTrack's also causes this. |
| `422 UPLOAD_REJECTED` | The file's bytes are not a real PDF/DOC/DOCX/PNG/JPEG, or the upload was truncated. |
| `404 FILE_MISSING` on download | The record is ready but the object is gone (deleted in the dashboard?). Replace the file. |
| Old bytes still in the bucket after a remove | A delete failed. The daily job retries it (`storage` in the job result). |

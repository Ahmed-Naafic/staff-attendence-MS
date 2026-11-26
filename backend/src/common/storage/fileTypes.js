import { badRequest } from '../httpError.js';

/*
 * File types and validation for stored files (docs/storage/supabase-storage.md → Validation).
 *
 * The browser's file name and Content-Type are only hints. The type is decided by the extension of
 * the name (it must be one the use allows, and the browser's type — when it gives one — must agree),
 * the content type the file is stored with is the server's canonical one, and once the bytes are in
 * storage their first bytes are checked against the type's signature (`sniffType`) before the file
 * is accepted. Stored object names never come from the user: they are `<fileId>.<ext>` under a path
 * built from server-side ids (storageKeys.js).
 */

export const FILE_TYPES = {
  pdf: { ext: 'pdf', mime: 'application/pdf', label: 'PDF' },
  doc: { ext: 'doc', mime: 'application/msword', label: 'Word (.doc)' },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word (.docx)' },
  png: { ext: 'png', mime: 'image/png', label: 'PNG image' },
  jpg: { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG image' },
};
const EXTENSION_ALIASES = { jpeg: 'jpg' };
// Types browsers send when they do not know better; they say nothing about the file.
const VAGUE_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/x-unknown']);
// Other names some systems use for the same types.
const MIME_ALIASES = { 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'application/x-pdf': 'pdf', 'application/vnd.ms-word': 'doc' };

/** Bytes needed by `sniffType`. */
export const SNIFF_BYTES = 16;

const startsWith = (bytes, signature) => bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
const SIGNATURES = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  doc: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE2 compound file (Word 97–2003)
  docx: [0x50, 0x4b, 0x03, 0x04], // ZIP (Office Open XML)
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
};

/**
 * Whether the first bytes of a file match the expected type. PDF may have up to 1 KB of junk before
 * %PDF- in theory; real files start with it, and we require that. OLE2 and ZIP signatures are shared
 * with other Office/ZIP formats — the extension narrows it down; this check stops renamed
 * executables, scripts, HTML and the like.
 */
export function sniffType(bytes, ext) {
  const signature = SIGNATURES[ext];
  return Boolean(signature && bytes && startsWith(Uint8Array.from(bytes), signature));
}

/**
 * A safe display name: no path, no control or reserved characters, no leading dots, at most
 * `max` characters (keeping the extension). Returns '' when nothing usable is left.
 */
export function safeFileName(name, max = 120) {
  if (typeof name !== 'string') return '';
  let clean = name
    .normalize('NFC')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (clean.length > max) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
    clean = clean.slice(0, max - ext.length).trimEnd() + ext;
  }
  return clean;
}

/** The type of a file name by its extension, or null. */
export function typeOfName(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return FILE_TYPES[EXTENSION_ALIASES[ext] ?? ext] ?? null;
}

const typeOfMime = (mime) => Object.values(FILE_TYPES).find((t) => t.mime === mime) ?? FILE_TYPES[MIME_ALIASES[mime]] ?? null;

/**
 * Validates an upload request: { fileName, contentType?, size } against an allowed list of type
 * keys and a size limit. Returns { fileName, type, size } or throws 400 with field errors.
 */
export function readFileDescriptor(body, { allowed, maxBytes }) {
  const errors = {};
  const fileName = safeFileName(body.fileName);
  const allowedTypes = allowed.map((k) => FILE_TYPES[k]);
  const allowedText = allowedTypes.map((t) => t.label).join(', ');
  let type = null;
  if (!fileName) errors.fileName = 'A file name of at most 120 characters.';
  else {
    type = typeOfName(fileName);
    if (!type || !allowed.includes(type.ext)) errors.fileName = `Allowed: ${allowedText}.`;
  }
  const mime = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase().split(';')[0] : '';
  if (body.contentType !== undefined && typeof body.contentType !== 'string') errors.contentType = 'The file type is not valid.';
  else if (type && !errors.fileName && !VAGUE_MIME.has(mime) && typeOfMime(mime)?.ext !== type.ext) errors.contentType = `The file type does not match its name (.${type.ext}).`;
  if (!Number.isInteger(body.size) || body.size < 1) errors.size = 'The file is empty.';
  else if (body.size > maxBytes) errors.size = `At most ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { fileName, type, size: body.size };
}

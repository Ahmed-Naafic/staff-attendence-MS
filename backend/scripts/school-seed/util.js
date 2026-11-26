/*
 * Shared helpers of the school seed (scripts/seed-school.js): dates, deterministic random numbers,
 * Somali names, and a signed-in client of the in-process API.
 */
import { randomUUID } from 'node:crypto';
import { createSession, SESSION_COOKIE } from '../../src/features/auth/sessions.js';

export const WEEKDAY_OF = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const weekday = (date) => WEEKDAY_OF[new Date(`${date}T00:00:00Z`).getUTCDay()];
export const dbDate = (date) => new Date(`${date}T00:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const pad = (n, size) => String(n).padStart(size, '0');
export const minutes = (n) => n * 60_000;
export const key = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Deterministic random numbers (mulberry32), so a reseed gives the same picture. */
export function rngFrom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.between = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return next;
}

export const MALE = ['Maxamed', 'Axmed', 'Cali', 'Xasan', 'Xuseen', 'Cabdi', 'Yuusuf', 'Ibraahim', 'Cumar', 'Mahad', 'Cabdiraxmaan', 'Cabdullaahi', 'Bashiir', 'Faarax', 'Liibaan', 'Saciid', 'Khaalid', 'Nuur', 'Cabdiqaadir', 'Mustafe', 'Ismaaciil', 'Abshir', 'Guuleed', 'Sharmaarke', 'Daahir', 'Cabdirisaaq', 'Hamse', 'Zakariye', 'Anwar', 'Ilyaas'];
export const FEMALE = ['Faadumo', 'Caasha', 'Maryan', 'Hodan', 'Sahra', 'Ifrax', 'Hibo', 'Nimco', 'Ayaan', 'Khadra', 'Ubax', 'Ilhaan', 'Deeqa', 'Sagal', 'Hamdi', 'Fardowsa', 'Muna', 'Xaliimo', 'Najma', 'Ruqiya', 'Shukri', 'Asma', 'Istahil', 'Leylo', 'Hawa', 'Saynab', 'Kowsar', 'Bilan', 'Nasteexo', 'Ikraan'];
export const FAMILY = ['Warsame', 'Jaamac', 'Nuur', 'Aadan', 'Faarax', 'Cismaan', 'Yuusuf', 'Ciise', 'Muuse', 'Daahir', 'Guuleed', 'Shire', 'Samatar', 'Xirsi', 'Cilmi', 'Siciid', 'Barre', 'Gacal', 'Maxamuud', 'Xaashi', 'Rooble', 'Afrax', 'Dualle', 'Mire', 'Qorane', 'Calasow', 'Hiiraab', 'Iimaan'];
export const AREAS = ['Hodan', 'Wadajir', 'Kaaraan', 'Hawl Wadaag', 'Yaaqshiid', 'Dayniile', 'Darusalaam', 'Tawakal', 'Shibis', 'Waaberi'];

const ORIGIN = 'http://localhost:5173';

/** Starts the API in-process (once) and returns its base URL and a close function. */
let started;
export async function startApi() {
  if (!started) {
    const { default: app } = await import('../../src/app.js');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    started = { base: `http://127.0.0.1:${server.address().port}`, server, tokens: [] };
  }
  return started;
}
export async function stopApi(prisma) {
  if (!started) return;
  await new Promise((resolve) => started.server.close(resolve));
  // The sessions the seed opened for itself are removed again.
  const { createHash } = await import('node:crypto');
  const hashes = started.tokens.map((t) => createHash('sha256').update(t).digest('hex'));
  if (hashes.length) await prisma.session.deleteMany({ where: { tokenHash: { in: hashes } } });
  started = undefined;
}

/**
 * A client of the in-process API acting as `user` (any role), through a session the seed opens for
 * that user directly (no password needed; removed again by stopApi). `prefix` e.g. "owner/exams".
 */
export async function apiAs(user, prefix) {
  const api = await startApi();
  const { token } = await createSession(user.id, { ipAddress: '127.0.0.1', userAgent: 'EduTrack school seed', lifetimeHours: 6 });
  api.tokens.push(token);
  const cookie = `${SESSION_COOKIE}=${token}`;
  // Neon now and then drops a pooled connection: a request that fails with a server error is tried
  // again (the API's writes are safe to repeat: payments carry a requestKey, marks are replaced).
  const once = async (path, options) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await request(path, options);
      } catch (e) {
        const retry = attempt < 16 && (!e.status || e.status >= 500);
        if (!retry) throw e;
        await new Promise((r) => setTimeout(r, Math.min(5000 * attempt, 60_000)));
      }
    }
  };
  const request = async (path, { method = 'GET', body, query } = {}) => {
    const url = new URL(`${api.base}/api/${prefix}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const response = await fetch(url, {
      method,
      headers: { cookie, ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text && (response.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`${method} ${prefix}${path} → ${response.status} ${data?.code ?? ''}: ${data?.error ?? text.slice(0, 300)}${data?.details ? ` ${JSON.stringify(data.details).slice(0, 300)}` : ''}`);
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  };
  return once;
}

export const newId = randomUUID;

/** createMany in chunks (large tables). */
export async function insertMany(client, model, rows, size = 2000) {
  for (let i = 0; i < rows.length; i += size) await client[model].createMany({ data: rows.slice(i, i + size) });
  return rows.length;
}

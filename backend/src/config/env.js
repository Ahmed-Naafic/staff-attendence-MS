import 'dotenv/config';

// Centralised access to environment variables. Values come from backend/.env (production
// branch) or backend/.env.dev (Neon dev branch; loaded first by `npm run dev` and `npm test`).
// See the repository-level .env.example. No secrets are hardcoded here.
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  // Origin of the web app. State-changing requests from any other origin are refused.
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  // Fallback session lifetime (hours) when Platform Settings has none; used only when it is a
  // whole number from 1 to 72 (see features/auth/authPolicy.js). Undefined when not set.
  sessionHours: process.env.SESSION_HOURS === undefined ? undefined : Number(process.env.SESSION_HOURS),
  // Set to "1" by Vercel on its build and function environments (a Vercel system variable).
  onVercel: process.env.VERCEL === '1',
  // Notifications (docs/notifications/). The scheduled job endpoint answers only requests that send
  // `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends it when CRON_SECRET is set); without
  // a secret the endpoint is disabled.
  cronSecret: process.env.CRON_SECRET || undefined,
  // How long one job run may work before it stops and leaves the rest for the next run (ms).
  jobBudgetMs: Number(process.env.NOTIFICATION_JOB_BUDGET_MS ?? 45_000),
  // Expo push service (Staff app push notifications). The access token is optional (needed only when
  // "enhanced push security" is turned on for the Expo project).
  expoPushUrl: process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send',
  expoReceiptsUrl: process.env.EXPO_RECEIPTS_URL || 'https://exp.host/--/api/v2/push/getReceipts',
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  // Data & Backup (docs/data-backup/): backups are Neon snapshots of this deployment's branch, made
  // through the Neon API. Without the key, project and branch the module shows "not configured".
  // The key can manage the whole Neon project: keep it only in the server's environment.
  neonApiKey: process.env.NEON_API_KEY || undefined,
  neonProjectId: process.env.NEON_PROJECT_ID || undefined,
  neonBranchId: process.env.NEON_BRANCH_ID || undefined,
  neonApiUrl: (process.env.NEON_API_URL || 'https://console.neon.tech/api/v2').replace(/\/$/, ''),
  // Database and role used to check a staged restore (defaults: neondb and DIRECT_URL's user).
  neonDatabaseName: process.env.NEON_DATABASE_NAME || 'neondb',
  neonRoleName: process.env.NEON_ROLE_NAME || undefined,
  // File storage (docs/storage/supabase-storage.md): one PRIVATE Supabase Storage bucket for every
  // module (examination papers first). The secret key (sb_secret_…, or a legacy service_role key) can
  // read and write every file of the project and bypasses Storage RLS: it stays in the server's
  // environment only — never in the web app (VITE_…) or the Staff app (EXPO_PUBLIC_…). Without URL and
  // key, storage features say "not set up" (503 STORAGE_NOT_CONFIGURED). Checked at startup
  // (common/storage/storageConfig.js); STORAGE_REQUIRED=true makes a missing or invalid configuration
  // stop the server instead of only being reported.
  supabaseUrl: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '') || undefined,
  supabaseSecretKey: (process.env.SUPABASE_SECRET_KEY || '').trim() || undefined,
  storageBucket: (process.env.SUPABASE_STORAGE_BUCKET || '').trim() || 'edutrack-files',
  // Largest file accepted, in MB (default 20, the examination paper rule). Keep the bucket's own
  // "file size limit" in the Supabase dashboard at least this large.
  storageMaxFileMb: process.env.STORAGE_MAX_FILE_MB === undefined ? 20 : Number(process.env.STORAGE_MAX_FILE_MB),
  storageRequired: process.env.STORAGE_REQUIRED === 'true',
  // Sample data (e.g. Manager → Staff → Add Sample Staff): only on a test system — the Neon dev
  // branch (EDUTRACK_DB_BRANCH=dev), or where SAMPLE_DATA=on is set. Off in production by default.
  sampleData: process.env.SAMPLE_DATA === 'on' || process.env.EDUTRACK_DB_BRANCH === 'dev',
};

export const isProduction = env.nodeEnv === 'production';

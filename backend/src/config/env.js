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
};

export const isProduction = env.nodeEnv === 'production';

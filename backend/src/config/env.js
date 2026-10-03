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
  // How long a sign-in lasts (hours). A technical default, not an approved business rule.
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
};

export const isProduction = env.nodeEnv === 'production';

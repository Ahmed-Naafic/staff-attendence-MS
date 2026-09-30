import 'dotenv/config';

// Centralised access to environment variables. Values come from backend/.env
// (see the repository-level .env.example). No secrets are hardcoded here.
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
};

export const isProduction = env.nodeEnv === 'production';

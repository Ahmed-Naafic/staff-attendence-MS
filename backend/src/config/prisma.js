import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';

// Shared Prisma client. The API uses the pooled Neon connection (DATABASE_URL).
// Created lazily so the server can start before a database is configured.
let prisma;

export function getPrisma() {
  if (!prisma) {
    if (!env.databaseUrl) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to backend/.env.');
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: env.databaseUrl,
        // Neon closes idle connections (and suspends idle compute). Release pooled connections
        // well before that, so a query never picks up a connection the server already closed.
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: 15_000,
      }),
    });
  }
  return prisma;
}

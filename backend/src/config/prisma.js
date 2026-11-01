import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';
import { zonedMidnight } from '../common/zonedTime.js';

// Shared Prisma client. The API uses the pooled Neon connection (DATABASE_URL).
// Created lazily so the server can start before a database is configured.
let prisma;

/**
 * A schedule version or assignment set saved without effectiveAt takes effect at 00:00 of its
 * effectiveFrom in its time zone (as the database trigger does), e.g. rows written by scripts and
 * tests. The services always give effectiveAt.
 */
const withEffectiveAt = (data) =>
  data.effectiveAt || !data.effectiveFrom || !data.timeZone ? data : { ...data, effectiveAt: zonedMidnight(new Date(data.effectiveFrom).toISOString().slice(0, 10), data.timeZone) };
const fillEffectiveAt = {
  create: ({ args, query }) => query({ ...args, data: withEffectiveAt(args.data) }),
  createMany: ({ args, query }) => query({ ...args, data: Array.isArray(args.data) ? args.data.map(withEffectiveAt) : withEffectiveAt(args.data) }),
  createManyAndReturn: ({ args, query }) => query({ ...args, data: Array.isArray(args.data) ? args.data.map(withEffectiveAt) : withEffectiveAt(args.data) }),
};

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
    }).$extends({ query: { branchSchedule: fillEffectiveAt, staffAssignment: fillEffectiveAt } });
  }
  return prisma;
}

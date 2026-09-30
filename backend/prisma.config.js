import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI configuration. The schema lives in the repository-level prisma/ folder.
// The CLI (migrations) uses the direct, non-pooled Neon connection.
export default defineConfig({
  schema: '../prisma/schema.prisma',
  migrations: {
    path: '../prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? '',
  },
});

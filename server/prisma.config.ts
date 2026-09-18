import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'esbuild prisma/seed.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/dp-seed.mjs --external:@prisma/client --external:@prisma/adapter-better-sqlite3 --external:better-sqlite3 && node node_modules/.cache/dp-seed.mjs',
  },
});

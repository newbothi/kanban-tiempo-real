import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// ENV_FILE permite usar otra configuración (p. ej. .env.test para los tests E2E).
config({ path: process.env.ENV_FILE ?? '.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

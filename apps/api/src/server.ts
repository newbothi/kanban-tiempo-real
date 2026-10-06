import { config } from 'dotenv';

// Carga apps/api/.env si existe (en un hosting, las variables vienen del panel y tienen prioridad).
// ENV_FILE permite usar otro archivo, p. ej. .env.test en los tests E2E.
config({ path: process.env.ENV_FILE ?? '.env', quiet: true });

const { buildApp } = await import('./app');
const { prisma } = await import('./db');

const app = await buildApp();

const close = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

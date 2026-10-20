import { config } from 'dotenv';
import { checkStartupConfig } from './startup';

// Carga apps/api/.env si existe (en un hosting, las variables vienen del panel y tienen prioridad).
// ENV_FILE permite usar otro archivo, p. ej. .env.test en los tests E2E.
config({ path: process.env.ENV_FILE ?? '.env', quiet: true });

// Sin token del ML o con un secreto de Key Vault sin resolver, mejor no arrancar
// y que el error se vea en el log del despliegue (S-06, S-13).
checkStartupConfig();

const { buildApp } = await import('./app');
const { prisma } = await import('./db');

// Solo para los E2E (NODE_ENV=test): varios navegadores registran usuarios desde la misma IP
// en el mismo minuto. En producción NODE_ENV=production y esta variable se ignora.
const e2eAuthLimit = process.env.NODE_ENV === 'test' ? Number(process.env.E2E_AUTH_RATE_LIMIT) || undefined : undefined;

const app = await buildApp({ authRateLimit: e2eAuthLimit });

const close = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

// Red de seguridad (S-01): una promesa rechazada que nadie atrapó se registra, pero
// no termina el proceso. Los handlers ya atrapan sus errores; esto cubre lo imprevisto.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'promesa rechazada sin manejar');
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

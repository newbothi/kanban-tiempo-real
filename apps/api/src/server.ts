import { config } from 'dotenv';

// Carga apps/api/.env si existe (en un hosting, las variables vienen del panel y tienen prioridad).
// ENV_FILE permite usar otro archivo, p. ej. .env.test en los tests E2E.
config({ path: process.env.ENV_FILE ?? '.env', quiet: true });

// En producción, el servicio ML exige un token: sin él, las métricas fallarían siempre.
// Mejor no arrancar y que el error se vea en el log del despliegue (S-06).
if (process.env.NODE_ENV === 'production' && (process.env.ML_TOKEN ?? '').length < 32) {
  throw new Error('ML_TOKEN es obligatorio en producción (mínimo 32 caracteres, el mismo del servicio ML)');
}

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

// Red de seguridad (S-01): una promesa rechazada que nadie atrapó se registra, pero
// no termina el proceso. Los handlers ya atrapan sus errores; esto cubre lo imprevisto.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'promesa rechazada sin manejar');
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

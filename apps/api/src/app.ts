import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { SOCKET_ID_HEADER } from '@kanban/shared';
import { prisma } from './db';
import { authPlugin } from './auth/plugin';
import { attachRealtime } from './realtime';
import { boardRoutes } from './routes/boards';
import { cardRoutes } from './routes/cards';

export interface BuildOptions {
  logger?: boolean;
  /** Intentos de login/registro por minuto por IP. */
  authRateLimit?: number;
  /** Carpeta con el front compilado (apps/web/dist). Si existe, la API también sirve la web. */
  webDist?: string;
}

const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * Construye la app sin ponerla a escuchar.
 * La usan server.ts (desarrollo/producción) y los tests de integración.
 */
export async function buildApp(opts: BuildOptions = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    // Detrás de un proxy (Render, Azure, Railway…) para que el rate limit vea la IP real.
    trustProxy: process.env.NODE_ENV === 'production',
  });

  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true, // permite enviar la cookie de sesión
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', SOCKET_ID_HEADER],
  });

  // Errores inesperados: el detalle va al log, nunca al cliente
  // (los mensajes de Prisma incluyen rutas de archivos y partes de la consulta).
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: 'InternalServerError', message: 'Error interno del servidor' });
    }
    return reply.code(status).send({ error: err.code ?? 'Error', message: err.message });
  });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  // Registro, login, logout, /me + el decorador app.authenticate
  await app.register(authPlugin, { rateLimitMax: opts.authRateLimit });

  await app.register(boardRoutes, { prefix: '/api' });
  await app.register(cardRoutes, { prefix: '/api' });

  // En producción, la misma API sirve el front compilado: un solo origen,
  // así la cookie de sesión y el WebSocket funcionan sin configurar CORS.
  const webDist = opts.webDist ?? DEFAULT_WEB_DIST;
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/socket.io')) {
        return reply.sendFile('index.html'); // SPA
      }
      return reply.code(404).send({ error: 'NotFound', message: 'Ruta no encontrada' });
    });
  }

  // Socket.IO comparte el servidor HTTP de Fastify (ruta /socket.io).
  const io = attachRealtime(app);
  app.addHook('preClose', async () => {
    io.disconnectSockets(true); // si no, los WebSockets abiertos impiden cerrar el servidor
  });

  return app;
}

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { SOCKET_ID_HEADER } from '@kanban/shared';
import { isConflict, prisma } from './db';
import { authPlugin } from './auth/plugin';
import { attachRealtime } from './realtime';
import { boardRoutes } from './routes/boards';
import { cardRoutes } from './routes/cards';
import { inviteLinkRoutes, inviteRoutes } from './routes/invites';
import { mailerFromEnv, type Mailer } from './mail';
import type { ThrottleOptions } from './auth/throttle';
import { MetricsService, type MetricsOptions } from './ml/metrics';
import { allowedOrigins } from './origins';
import { SlidingWindowLimiter, resolveLimits, type LimitsOptions } from './limits';

export interface BuildOptions {
  logger?: boolean;
  /** Intentos de login/registro por minuto por IP. */
  authRateLimit?: number;
  /** Carpeta con el front compilado (apps/web/dist). Si existe, la API también sirve la web. */
  webDist?: string;
  /**
   * Saltos de proxy en los que se confía para leer la IP del cliente (X-Forwarded-For).
   * Por defecto: TRUST_PROXY_HOPS, o 1 en producción (el front-end de Azure) y ninguno en desarrollo.
   * Nunca `true`: así se confiaría también en lo que escribe el cliente (S-02).
   */
  trustProxy?: number | false;
  /** Freno por correo en el login (intentos libres y esperas). */
  loginThrottle?: ThrottleOptions;
  /** Caché y límites del cálculo de métricas. */
  metrics?: MetricsOptions;
  /** Topes por usuario y por tablero (S-16). */
  limits?: LimitsOptions;
  /** Envío de correos. Por defecto, según RESEND_API_KEY / MAIL_FROM (ver mail.ts). */
  mailer?: Mailer;
}

/** Confía solo en los últimos `hops` saltos (lo mismo que hace proxy-addr con un número). */
function trustHops(hops: number | false) {
  return hops === false ? false : (_address: string, hop: number) => hop < hops;
}

function defaultTrustProxy(): number | false {
  const hops = process.env.TRUST_PROXY_HOPS;
  if (hops !== undefined && hops !== '') return Number(hops) > 0 ? Number(hops) : false;
  return process.env.NODE_ENV === 'production' ? 1 : false;
}

const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * Construye la app sin ponerla a escuchar.
 * La usan server.ts (desarrollo/producción) y los tests de integración.
 */
export async function buildApp(opts: BuildOptions = {}) {
  const production = process.env.NODE_ENV === 'production';
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            // Nunca al log: cookies, cabeceras de autenticación ni contraseñas o sus hashes.
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'res.headers["set-cookie"]',
                '*.password',
                '*.passwordHash',
                '*.*.password',
                '*.*.passwordHash',
              ],
              censor: '[oculto]',
            },
          },
    // Detrás de un proxy (Azure) para que el rate limit vea la IP real: se confía SOLO
    // en el último salto, el que agrega el proxy, no en lo que manda el navegador.
    trustProxy: trustHops(opts.trustProxy ?? defaultTrustProxy()),
  });

  // S-11: cabeceras de seguridad en todas las respuestas (API y web).
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"], // incluye el WebSocket del mismo origen
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"], // nadie puede meter la app en un iframe (clickjacking)
        ...(production ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // HSTS: el navegador recuerda usar solo HTTPS durante un año.
    strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    // Todo lo que carga la app es del mismo origen, así que se puede exigir (ZAP 90004).
    crossOriginEmbedderPolicy: { policy: 'require-corp' },
  });
  // La app no usa cámara, micrófono, ubicación ni pagos: se desactivan para cualquier
  // contenido que lograra colarse en la página (ZAP 10063).
  app.addHook('onSend', async (_req, reply) => {
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  });

  // CORS solo si la web vive en otro origen (desarrollo con Vite). En producción todo
  // comparte origen, así que no se habilita ninguno (S-15).
  const origins = allowedOrigins();
  if (origins.length) {
    await app.register(cors, {
      origin: origins,
      credentials: true, // permite enviar la cookie de sesión
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', SOCKET_ID_HEADER],
    });
  }

  // Errores inesperados: el detalle va al log, nunca al cliente
  // (los mensajes de Prisma incluyen rutas de archivos y partes de la consulta).
  app.setErrorHandler((err: FastifyError, req, reply) => {
    // Un conflicto de concurrencia que sobrevivió a los reintentos: no es un bug del cliente
    // ni del servidor, es carga. Se responde 503 con Retry-After para que vuelva a intentar.
    if (isConflict(err)) {
      req.log.warn({ err }, 'conflicto de concurrencia tras reintentos');
      return reply.code(503).header('retry-after', '1').send({
        error: 'ServiceUnavailable',
        message: 'El servidor está ocupado; intenta de nuevo en un momento',
      });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(err);
      // Solo dentro de los tests (Vitest, o el servidor de los E2E con NODE_ENV=test): el detalle
      // ayuda a diagnosticar fallas en el CI. En producción el cliente nunca lo ve.
      const debug = process.env.VITEST || process.env.NODE_ENV === 'test' ? { debug: `${(err as { code?: string }).code ?? ''} ${err.message}`.slice(0, 500) } : {};
      return reply.code(500).send({ error: 'InternalServerError', message: 'Error interno del servidor', ...debug });
    }
    return reply.code(status).send({ error: err.code ?? 'Error', message: err.message });
  });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  // Registro, login, logout, /me + el decorador app.authenticate
  const mailer = opts.mailer ?? mailerFromEnv(app.log);
  await app.register(authPlugin, { rateLimitMax: opts.authRateLimit, throttle: opts.loginThrottle, mailer });

  const limits = resolveLimits(opts.limits);
  const writes = new SlidingWindowLimiter(limits.writesPerMinute, 60_000);
  await app.register(boardRoutes, {
    prefix: '/api',
    metrics: new MetricsService(opts.metrics),
    limits,
    writes,
    mailer,
  });
  await app.register(cardRoutes, { prefix: '/api', limits, writes });
  await app.register(inviteRoutes, { prefix: '/api', writes, mailer });
  await app.register(inviteLinkRoutes, { prefix: '/api' });

  // En producción, la misma API sirve el front compilado: un solo origen,
  // así la cookie de sesión y el WebSocket funcionan sin configurar CORS.
  const webDist = opts.webDist ?? DEFAULT_WEB_DIST;
  if (existsSync(webDist)) {
    // dotfiles: 'deny' → nunca se sirve un archivo oculto (.env, .git…) aunque aparezca en la carpeta.
    await app.register(fastifyStatic, { root: webDist, wildcard: false, dotfiles: 'deny' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/socket.io')) {
        return reply.sendFile('index.html'); // SPA
      }
      return reply.code(404).send({ error: 'NotFound', message: 'Ruta no encontrada' });
    });
  }

  // Socket.IO comparte el servidor HTTP de Fastify (ruta /socket.io).
  const io = attachRealtime(app, { socketEventsPer10s: limits.socketEventsPer10s });
  app.addHook('preClose', async () => {
    io.disconnectSockets(true); // si no, los WebSockets abiertos impiden cerrar el servidor
  });

  return app;
}

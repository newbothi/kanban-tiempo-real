import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { loginSchema, registerSchema, type UserDto } from '@kanban/shared';
import { prisma } from '../db';
import { clientIp, parseOr400 } from '../http';
import { LoginThrottle, type ThrottleOptions } from './throttle';
import { demoEmail, isSessionCurrent, sessionCookieName, type SessionClaims } from './session';
import { getJwtSecret } from './secret';
import { endSessions, notify } from '../realtime';
import { type Mailer, verificationEmail } from '../mail';
import { resetDemoIfStale } from '../demo/demo';
import { SlidingWindowLimiter } from '../limits';

// Tipos del payload del JWT: `sub` es el id del usuario.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionClaims;
    user: SessionClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler que exige sesión válida; deja el id en req.user.sub */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export { getJwtSecret };

const userSelect = { id: true, email: true, name: true, emailVerifiedAt: true } as const;

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** URL pública de la app, para los enlaces de los correos. */
function publicUrl(req: FastifyRequest): string {
  return (process.env.PUBLIC_URL ?? `${req.protocol}://${req.host}`).replace(/\/$/, '');
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(sessionCookieName(), token, {
    path: '/',
    httpOnly: true, // el JavaScript del navegador NO puede leerla (protege contra XSS)
    sameSite: 'lax', // no se envía en POSTs desde otros sitios (protege contra CSRF)
    secure: process.env.NODE_ENV === 'production', // en producción, solo por HTTPS
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/**
 * Hash con el que comparamos cuando el correo no existe, para que la respuesta
 * tarde lo mismo exista o no el usuario (no revelar qué correos están registrados).
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

export interface AuthOptions {
  /** Intentos de login/registro por minuto por IP (por defecto 10). */
  rateLimitMax?: number;
  /** Freno por correo en el login. */
  throttle?: ThrottleOptions;
  /** Envío de correos (verificación). */
  mailer: Mailer;
}

export const authPlugin = fp(async (app: FastifyInstance, opts: AuthOptions) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: getJwtSecret(),
    cookie: { cookieName: sessionCookieName(), signed: false },
    sign: { expiresIn: `${SESSION_DAYS}d` },
  });
  // La clave del rate limit es la IP real del cliente, sin puerto (ver clientIp).
  await app.register(rateLimit, { global: false, keyGenerator: clientIp });
  const throttle = new LoginThrottle(opts.throttle);
  const resends = new SlidingWindowLimiter(3, 60 * 60 * 1000); // reenvíos de verificación por usuario y hora

  const toUserDto = (u: { id: string; email: string; name: string; emailVerifiedAt: Date | null }): UserDto => ({
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: u.emailVerifiedAt !== null,
    verificationRequired: opts.mailer.enabled,
    isDemo: u.email === demoEmail(),
  });

  /** Crea un token de verificación nuevo (solo se guarda su hash) y envía el enlace por correo. */
  async function sendVerification(req: FastifyRequest, user: { id: string; email: string; name: string }) {
    if (!opts.mailer.enabled) return;
    const token = randomBytes(32).toString('base64url');
    await prisma.user.update({
      where: { id: user.id },
      data: { verifyTokenHash: sha256(token), verifyTokenExpiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
    });
    const link = `${publicUrl(req)}/api/auth/verify?token=${token}`;
    try {
      await opts.mailer.send({ to: user.email, ...verificationEmail(user.name, link) });
    } catch (err) {
      req.log.error({ err }, 'no se pudo enviar el correo de verificación');
    }
  }

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
      // Firma y vencimiento correctos no bastan: la sesión pudo cerrarse después (S-10).
      if (await isSessionCurrent(req.user)) return;
    } catch {
      // token ausente, alterado o vencido
    }
    reply.clearCookie(sessionCookieName(), { path: '/' });
    return reply.code(401).send({ error: 'Unauthorized', message: 'Inicia sesión' });
  });

  // Login y registro: máximo 10 intentos por minuto por IP (frena fuerza bruta).
  const limited = {
    config: { rateLimit: { max: opts.rateLimitMax ?? 10, timeWindow: '1 minute' } },
  };

  app.post('/api/auth/register', limited, async (req, reply) => {
    const input = parseOr400(registerSchema, req.body, reply);
    if (!input) return;

    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) {
      return reply.code(409).send({ error: 'Conflict', message: 'Ese correo ya está registrado' });
    }

    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      },
      select: userSelect,
    });
    await sendVerification(req, user);

    setSessionCookie(reply, await reply.jwtSign({ sub: user.id, sv: 0 }));
    return reply.code(201).send(toUserDto(user));
  });

  app.post('/api/auth/login', limited, async (req, reply) => {
    const input = parseOr400(loginSchema, req.body, reply);
    if (!input) return;

    // Freno por cuenta: aunque el atacante cambie de IP, cada correo tiene pocos intentos.
    // Se aplica igual a correos que no existen (no revela cuáles están registrados).
    const wait = throttle.retryAfterMs(input.email);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      return reply
        .code(429)
        .header('retry-after', String(seconds))
        .send({ error: 'TooManyAttempts', message: `Demasiados intentos. Vuelve a intentar en ${seconds} s.` });
    }

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throttle.fail(input.email);
      // Mismo mensaje en ambos casos: no revelamos si el correo existe.
      return reply.code(401).send({ error: 'Unauthorized', message: 'Correo o contraseña incorrectos' });
    }
    throttle.success(input.email);

    // S-18: la demo vuelve a su estado original una vez al día (al iniciar sesión).
    try {
      await resetDemoIfStale(user.id);
    } catch (err) {
      req.log.error({ err }, 'no se pudo reiniciar la cuenta demo');
    }

    setSessionCookie(reply, await reply.jwtSign({ sub: user.id, sv: user.sessionVersion }));
    return toUserDto(user);
  });

  /**
   * Cerrar sesión la cierra en TODOS los dispositivos (S-10): se incrementa la versión de
   * sesión, así que los tokens anteriores dejan de valer (aunque alguien haya copiado la
   * cookie), y se desconectan los WebSockets abiertos de ese usuario.
   * Excepción: la cuenta demo es compartida; ahí solo se borra la cookie de este navegador.
   */
  app.post('/api/auth/logout', async (req, reply) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
      const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { email: true } });
      if (user && user.email !== demoEmail() && (await isSessionCurrent(req.user))) {
        await prisma.user.update({ where: { id: req.user.sub }, data: { sessionVersion: { increment: 1 } } });
        endSessions(req.user.sub);
      }
    } catch {
      // Sin sesión válida no hay nada que revocar: solo se borra la cookie.
    }
    reply.clearCookie(sessionCookieName(), { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: userSelect });
    if (!user) {
      // El token es válido pero el usuario ya no existe.
      reply.clearCookie(sessionCookieName(), { path: '/' });
      return reply.code(401).send({ error: 'Unauthorized', message: 'Inicia sesión' });
    }
    return toUserDto(user);
  });

  /**
   * S-09: enlace del correo de verificación. Es un GET porque se abre desde el cliente de
   * correo; el token es aleatorio, de un solo uso y vence en 24 horas, y en la base solo
   * está su hash. Redirige a la app con el resultado.
   */
  app.get<{ Querystring: { token?: string } }>('/api/auth/verify', limited, async (req, reply) => {
    const token = req.query.token ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return reply.redirect('/?verificado=0');
    const user = await prisma.user.findFirst({
      where: { verifyTokenHash: sha256(token), verifyTokenExpiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!user) return reply.redirect('/?verificado=0');
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verifyTokenHash: null, verifyTokenExpiresAt: null },
    });
    notify.invitesChanged(user.id); // ya puede ver y aceptar sus invitaciones
    return reply.redirect('/?verificado=1');
  });

  app.post('/api/auth/verify/resend', { preHandler: app.authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: userSelect });
    if (!user || user.emailVerifiedAt || !opts.mailer.enabled) return reply.code(204).send();
    const wait = resends.take(user.id);
    if (wait > 0) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil(wait / 1000)))
        .send({ error: 'TooManyRequests', message: 'Ya te enviamos varios correos; espera un rato antes de pedir otro' });
    }
    await sendVerification(req, user);
    return reply.code(204).send();
  });
});

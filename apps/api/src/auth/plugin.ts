import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { SESSION_COOKIE, loginSchema, registerSchema, type UserDto } from '@kanban/shared';
import { prisma } from '../db';
import { parseOr400 } from '../http';

// Tipos del payload del JWT: `sub` es el id del usuario.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
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

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'Falta JWT_SECRET en apps/api/.env (mínimo 32 caracteres). Revisa .env.example.',
    );
  }
  return secret;
}

const userSelect = { id: true, email: true, name: true } as const;

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
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
}

export const authPlugin = fp(async (app: FastifyInstance, opts: AuthOptions) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: getJwtSecret(),
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: `${SESSION_DAYS}d` },
  });
  await app.register(rateLimit, { global: false });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Inicia sesión' });
    }
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

    const user: UserDto = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      },
      select: userSelect,
    });

    setSessionCookie(reply, await reply.jwtSign({ sub: user.id }));
    return reply.code(201).send(user);
  });

  app.post('/api/auth/login', limited, async (req, reply) => {
    const input = parseOr400(loginSchema, req.body, reply);
    if (!input) return;

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      // Mismo mensaje en ambos casos: no revelamos si el correo existe.
      return reply.code(401).send({ error: 'Unauthorized', message: 'Correo o contraseña incorrectos' });
    }

    setSessionCookie(reply, await reply.jwtSign({ sub: user.id }));
    return { id: user.id, email: user.email, name: user.name } satisfies UserDto;
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: userSelect });
    if (!user) {
      // El token es válido pero el usuario ya no existe.
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(401).send({ error: 'Unauthorized', message: 'Inicia sesión' });
    }
    return user;
  });
});

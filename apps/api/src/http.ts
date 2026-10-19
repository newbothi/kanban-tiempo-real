import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import type { SlidingWindowLimiter } from './limits';

/** Valida con Zod; si falla responde 400 y devuelve null. */
export function parseOr400<S extends z.ZodType>(
  schema: S,
  data: unknown,
  reply: FastifyReply,
): z.infer<S> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.code(400).send({ error: 'ValidationError', issues: result.error.issues });
    return null;
  }
  return result.data;
}

export function notFound(reply: FastifyReply, what: string) {
  return reply.code(404).send({ error: 'NotFound', message: `${what} no existe` });
}

/**
 * IP del cliente para el rate limit.
 *
 * Con `trustProxy` en 1 (un salto: el front-end de Azure), Fastify toma la ÚLTIMA
 * entrada de X-Forwarded-For, la que agrega Azure, y no la primera, que la escribe
 * el cliente y se puede falsear (S-02). Azure la envía como "ip:puerto": le quitamos
 * el puerto para que cada conexión nueva no cuente como una IP distinta.
 */
export function clientIp(req: { ip: string }): string {
  const ip = req.ip;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4) return v4[1]!;
  const v6 = /^\[([0-9a-fA-F:.]+)\]:\d+$/.exec(ip);
  if (v6) return v6[1]!;
  return ip;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Todos los :id de las rutas son UUID. Uno con otro formato no puede existir:
 * se responde 404 de inmediato, sin consultar la base (S-16).
 */
export async function rejectMalformedIds(req: FastifyRequest, reply: FastifyReply) {
  const params = (req.params ?? {}) as Record<string, unknown>;
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && !UUID.test(value)) {
      return reply.code(404).send({ error: 'NotFound', message: 'No existe' });
    }
  }
}

/** preHandler: limita las escrituras (POST, PATCH, DELETE) por usuario (S-16). */
export function limitWrites(limiter: SlidingWindowLimiter) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const wait = limiter.take(req.user.sub);
    if (wait > 0) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil(wait / 1000)))
        .send({ error: 'TooManyRequests', message: 'Demasiados cambios seguidos; espera un momento' });
    }
  };
}

/** URL pública de la app, para los enlaces de los correos. */
export function publicUrl(req: FastifyRequest): string {
  return (process.env.PUBLIC_URL ?? `${req.protocol}://${req.host}`).replace(/\/$/, '');
}

/** Token aleatorio para enlaces de un solo uso. En la base solo se guarda `hashToken(token)`. */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

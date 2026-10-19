import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

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

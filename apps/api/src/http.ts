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

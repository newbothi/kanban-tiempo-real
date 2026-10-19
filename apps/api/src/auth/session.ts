import { SESSION_COOKIE } from '@kanban/shared';
import { prisma } from '../db';

/** Lo que va dentro del JWT de sesión. */
export interface SessionClaims {
  /** id del usuario */
  sub: string;
  /** Versión de sesión del usuario al emitir el token (S-10). Los tokens antiguos no la traen: cuenta como 0. */
  sv?: number;
  /** Vencimiento (segundos desde 1970), lo agrega @fastify/jwt. */
  exp?: number;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Nombre de la cookie. En producción lleva el prefijo `__Host-`: el navegador solo la
 * acepta si es Secure, con path=/ y sin Domain, así que ningún subdominio puede pisarla.
 */
export function sessionCookieName(): string {
  return isProduction() ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/** Correo de la cuenta demo pública (tiene restricciones: ver demo.ts). */
export function demoEmail(): string {
  return (process.env.DEMO_EMAIL ?? 'demo@kanban.cl').toLowerCase();
}

/**
 * ¿El token sigue vigente? Además de la firma y el vencimiento (los revisa el JWT),
 * su versión debe coincidir con la del usuario: cerrar sesión la incrementa y así
 * invalida todos los tokens emitidos antes, en cualquier dispositivo (S-10).
 */
export async function isSessionCurrent(claims: SessionClaims): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { sessionVersion: true },
  });
  return !!user && user.sessionVersion === (claims.sv ?? 0);
}

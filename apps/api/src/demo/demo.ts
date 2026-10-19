import type { FastifyReply } from 'fastify';
import { generateNKeysBetween } from 'fractional-indexing';
import { prisma } from '../db';
import { demoEmail } from '../auth/session';
import { createSimulatedBoard } from './simulated-board';

/**
 * La cuenta demo es pública (su contraseña está en el README). S-18:
 * - no puede invitar, quitar miembros, eliminar tableros ni aceptar invitaciones;
 * - sus tableros vuelven a su estado original una vez al día.
 */
export async function isDemoUser(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email === demoEmail();
}

/** Responde 403 si el usuario es la demo. Devuelve true si ya respondió. */
export async function rejectIfDemo(reply: FastifyReply, userId: string, what: string): Promise<boolean> {
  if (!(await isDemoUser(userId))) return false;
  reply.code(403).send({
    error: 'DemoRestricted',
    message: `La cuenta demo no puede ${what}. Crea tu propia cuenta para probarlo.`,
  });
  return true;
}

/** Tablero de bienvenida con algunas tarjetas de ejemplo. */
export async function createStarterBoard(ownerId: string) {
  const colKeys = generateNKeysBetween(null, null, 3);
  const seed: Record<string, string[]> = {
    'Por hacer': ['Diseñar pantalla de login', 'Escribir tests'],
    'En progreso': ['API de usuarios'],
    Hecho: ['Crear base de datos', 'Configurar repositorio'],
  };
  return prisma.board.create({
    data: {
      name: 'Mi primer tablero',
      members: { create: { userId: ownerId, role: 'owner' } },
      columns: {
        create: Object.entries(seed).map(([title, cards], i) => {
          const cardKeys = generateNKeysBetween(null, null, cards.length);
          return {
            title,
            position: colKeys[i]!,
            cards: { create: cards.map((t, j) => ({ title: t, position: cardKeys[j]! })) },
          };
        }),
      },
    },
    select: { id: true },
  });
}

const RESET_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Si pasó más de un día desde el último reinicio, borra los tableros propios de la demo
 * y crea de nuevo el de bienvenida y el simulado. Se hace al iniciar sesión (y no con un
 * temporizador) porque en el plan gratuito la app se duerme cuando nadie la usa.
 */
export async function resetDemoIfStale(userId: string, now = new Date()): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, demoResetAt: true } });
  if (!user || user.email !== demoEmail()) return false;
  if (user.demoResetAt && now.getTime() - user.demoResetAt.getTime() < RESET_EVERY_MS) return false;

  // Se marca primero: si dos visitantes entran a la vez, solo uno reinicia.
  const { count } = await prisma.user.updateMany({
    where: { id: userId, demoResetAt: user.demoResetAt },
    data: { demoResetAt: now },
  });
  if (count === 0) return false;

  const owned = await prisma.boardMember.findMany({ where: { userId, role: 'owner' }, select: { boardId: true } });
  await prisma.board.deleteMany({ where: { id: { in: owned.map((o) => o.boardId) } } });
  await createStarterBoard(userId);
  await createSimulatedBoard(userId);
  return true;
}

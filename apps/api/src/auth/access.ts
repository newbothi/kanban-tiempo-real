import type { FastifyReply } from 'fastify';
import type { BoardRole } from '@kanban/shared';
import { prisma } from '../db';

/** Rol del usuario en el tablero, o null si no es miembro. */
export async function roleIn(boardId: string, userId: string): Promise<BoardRole | null> {
  const m = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { role: true },
  });
  return (m?.role as BoardRole | undefined) ?? null;
}

/**
 * Exige que el usuario sea miembro (o dueño, si `need = 'owner'`).
 * - No miembro → 404: no revelamos que el tablero existe.
 * - Miembro sin el rol necesario → 403.
 * Devuelve el rol, o null si ya respondió con error.
 */
export async function requireBoardRole(
  reply: FastifyReply,
  boardId: string | null | undefined,
  userId: string,
  need: BoardRole = 'member',
): Promise<BoardRole | null> {
  const role = boardId ? await roleIn(boardId, userId) : null;
  if (!role) {
    reply.code(404).send({ error: 'NotFound', message: 'El tablero no existe' });
    return null;
  }
  if (need === 'owner' && role !== 'owner') {
    reply.code(403).send({ error: 'Forbidden', message: 'Solo el dueño del tablero puede hacer esto' });
    return null;
  }
  return role;
}

/** boardId de una columna o tarjeta (para chequear permisos). */
export async function boardIdOfColumn(columnId: string) {
  const col = await prisma.column.findUnique({ where: { id: columnId }, select: { boardId: true } });
  return col?.boardId ?? null;
}

export async function boardIdOfCard(cardId: string) {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { column: { select: { boardId: true } } },
  });
  return card?.column.boardId ?? null;
}

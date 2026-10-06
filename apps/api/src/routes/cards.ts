import type { FastifyInstance } from 'fastify';
import {
  createCardSchema,
  keyAtEnd,
  moveCardSchema,
  positionForMove,
  renameCardSchema,
  type CardDto,
} from '@kanban/shared';
import { prisma } from '../db';
import { notFound, parseOr400 } from '../http';
import { boardIdOfCard, boardIdOfColumn, requireBoardRole } from '../auth/access';
import { notify } from '../realtime';

const cardSelect = { id: true, columnId: true, title: true, position: true } as const;

export async function cardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Crear tarjeta al final de una columna
  app.post('/cards', async (req, reply) => {
    const input = parseOr400(createCardSchema, req.body, reply);
    if (!input) return;

    const boardId = await boardIdOfColumn(input.columnId);
    if (!(await requireBoardRole(reply, boardId, req.user.sub))) return;

    const card = await prisma.$transaction(async (tx) => {
      const last = await tx.card.findFirst({
        where: { columnId: input.columnId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      return tx.card.create({
        data: {
          columnId: input.columnId,
          title: input.title,
          position: keyAtEnd(last ? [last] : []),
        },
        select: cardSelect,
      });
    });

    notify.cardCreated(req, boardId!, card);
    return reply.code(201).send(card satisfies CardDto);
  });

  // Renombrar
  app.patch<{ Params: { id: string } }>('/cards/:id', async (req, reply) => {
    const input = parseOr400(renameCardSchema, req.body, reply);
    if (!input) return;

    const boardId = await boardIdOfCard(req.params.id);
    if (!boardId) return notFound(reply, 'La tarjeta');
    if (!(await requireBoardRole(reply, boardId, req.user.sub))) return;

    const card = await prisma.card.update({
      where: { id: req.params.id },
      data: { title: input.title },
      select: cardSelect,
    });
    notify.cardUpdated(req, boardId, card);
    return card;
  });

  // Mover: el cliente dice columna + índice; el servidor calcula la position definitiva.
  app.post<{ Params: { id: string } }>('/cards/:id/move', async (req, reply) => {
    const input = parseOr400(moveCardSchema, req.body, reply);
    if (!input) return;
    const cardId = req.params.id;

    const boardId = await boardIdOfCard(cardId);
    if (!boardId) return notFound(reply, 'La tarjeta');
    if (!(await requireBoardRole(reply, boardId, req.user.sub))) return;

    const result = await prisma.$transaction(async (tx) => {
      // La columna destino debe pertenecer al MISMO tablero
      // (si no, alguien podría mover tarjetas a un tablero ajeno).
      const target = await tx.column.findUnique({ where: { id: input.columnId } });
      if (!target || target.boardId !== boardId) return null;

      const siblings = await tx.card.findMany({
        where: { columnId: input.columnId },
        select: { id: true, columnId: true, position: true },
      });
      const position = positionForMove(siblings, cardId, input.columnId, input.index);

      return tx.card.update({
        where: { id: cardId },
        data: { columnId: input.columnId, position },
        select: cardSelect,
      });
    });

    if (!result) return notFound(reply, 'La columna');
    notify.cardUpdated(req, boardId, result);
    return result;
  });

  app.delete<{ Params: { id: string } }>('/cards/:id', async (req, reply) => {
    const boardId = await boardIdOfCard(req.params.id);
    if (!boardId) return notFound(reply, 'La tarjeta');
    if (!(await requireBoardRole(reply, boardId, req.user.sub))) return;

    await prisma.card.deleteMany({ where: { id: req.params.id } });
    notify.cardDeleted(req, boardId, req.params.id);
    return reply.code(204).send();
  });
}

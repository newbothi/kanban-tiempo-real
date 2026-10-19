import type { FastifyInstance } from 'fastify';
import {
  MAX_POSITION_LENGTH,
  createCardSchema,
  evenKeys,
  keyAtEnd,
  moveCardSchema,
  positionForMove,
  renameCardSchema,
  type CardDto,
} from '@kanban/shared';
import { prisma } from '../db';
import { limitWrites, notFound, parseOr400, rejectMalformedIds } from '../http';
import { boardIdOfCard, boardIdOfColumn, requireBoardRole } from '../auth/access';
import { notify } from '../realtime';
import type { RouteOptions } from './boards';

const cardSelect = { id: true, columnId: true, title: true, position: true } as const;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Bloqueo pesimista por columna (S-20): las creaciones y movimientos que tocan la misma
 * columna esperan su turno en vez de bloquearse mutuamente (deadlock) o calcular la misma
 * posición. UPDLOCK + HOLDLOCK sobre la fila de la columna dura hasta el fin de la
 * transacción. Siempre en el mismo orden (por id) para que dos movimientos entre las
 * mismas columnas no se crucen.
 */
async function lockColumns(tx: Tx, columnIds: string[]) {
  for (const id of [...new Set(columnIds)].sort()) {
    await tx.$queryRaw`SELECT [id] FROM [dbo].[Column] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${id}`;
  }
}

/**
 * Red de seguridad: si aun así SQL Server aborta una transacción por deadlock (error 1205;
 * Prisma: P2034) o una transacción no consigue conexión a tiempo (P2028), se reintenta
 * unas veces en vez de responder 500.
 */
async function withRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const conflict =
        e.code === 'P2034' || e.code === 'P2028' || /deadlock|1205|Unable to start a transaction/i.test(e.message ?? '');
      if (!conflict || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}

/**
 * S-20: vuelve a repartir las posiciones de una columna con claves cortas, en el orden
 * actual (empates por id). Se usa cuando una clave se alargó demasiado o cuando dos
 * tarjetas quedaron con la misma posición (p. ej. por dos creaciones simultáneas).
 */
async function rebalanceColumn(tx: Tx, columnId: string) {
  const cards = await tx.card.findMany({
    where: { columnId },
    select: { id: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  const keys = evenKeys(cards.length);
  for (const [i, c] of cards.entries()) {
    await tx.card.update({ where: { id: c.id }, data: { position: keys[i]! } });
  }
}

/**
 * Clave para el movimiento. Si alguna clave de la columna ya está demasiado larga, si la
 * nueva lo estaría, o si no se puede calcular (claves repetidas), reordena la columna y
 * vuelve a calcular.
 */
async function positionWithRebalance(tx: Tx, columnId: string, cardId: string, index: number) {
  const load = () =>
    tx.card.findMany({ where: { columnId }, select: { id: true, columnId: true, position: true } });
  try {
    const siblings = await load();
    if (!siblings.some((c) => c.position.length > MAX_POSITION_LENGTH)) {
      const position = positionForMove(siblings, cardId, columnId, index);
      if (position.length <= MAX_POSITION_LENGTH) return { position, rebalanced: false };
    }
  } catch {
    // claves duplicadas: generateKeyBetween no puede ubicar algo entre dos iguales
  }
  await rebalanceColumn(tx, columnId);
  return { position: positionForMove(await load(), cardId, columnId, index), rebalanced: true };
}

export async function cardRoutes(app: FastifyInstance, opts: RouteOptions) {
  app.addHook('preValidation', rejectMalformedIds);
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', limitWrites(opts.writes));

  // Crear tarjeta al final de una columna
  app.post('/cards', async (req, reply) => {
    const input = parseOr400(createCardSchema, req.body, reply);
    if (!input) return;

    const boardId = await boardIdOfColumn(input.columnId);
    if (!(await requireBoardRole(reply, boardId, req.user.sub))) return;

    // S-16: tope de tarjetas por tablero.
    const total = await prisma.card.count({ where: { column: { boardId: boardId! } } });
    if (total >= opts.limits.cardsPerBoard) {
      return reply.code(403).send({
        error: 'QuotaExceeded',
        message: `El tablero llegó al máximo de ${opts.limits.cardsPerBoard} tarjetas`,
      });
    }

    let rebalanced = false;
    const card = await withRetry(() => prisma.$transaction(async (tx: Tx) => {
      await lockColumns(tx, [input.columnId]);
      const lastKey = async () =>
        (
          await tx.card.findFirst({
            where: { columnId: input.columnId },
            orderBy: { position: 'desc' },
            select: { position: true },
          })
        )?.position;
      let last = await lastKey();
      if (last && last.length >= MAX_POSITION_LENGTH) {
        await rebalanceColumn(tx, input.columnId);
        rebalanced = true;
        last = await lastKey();
      }
      const created = await tx.card.create({
        data: {
          columnId: input.columnId,
          title: input.title,
          position: keyAtEnd(last ? [{ position: last }] : []),
        },
        select: cardSelect,
      });
      // El evento va en la MISMA transacción: si se guarda la tarjeta, se guarda su historial.
      await tx.cardEvent.create({
        data: { boardId: boardId!, cardId: created.id, type: 'created', toColumnId: input.columnId },
      });
      return created;
    }, { maxWait: 10_000 }));

    notify.cardCreated(req, boardId!, card);
    if (rebalanced) notify.boardReordered(boardId!);
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

    let rebalanced = false;
    const result = await withRetry(() => prisma.$transaction(
      async (tx) => {
      // La columna destino debe pertenecer al MISMO tablero
      // (si no, alguien podría mover tarjetas a un tablero ajeno).
      const target = await tx.column.findUnique({ where: { id: input.columnId } });
      if (!target || target.boardId !== boardId) return null;

      const current = await tx.card.findUniqueOrThrow({ where: { id: cardId }, select: { columnId: true } });
      await lockColumns(tx, [current.columnId, input.columnId]);

      const placed = await positionWithRebalance(tx, input.columnId, cardId, input.index);
      rebalanced = placed.rebalanced;
      const position = placed.position;

      const before = await tx.card.findUniqueOrThrow({
        where: { id: cardId },
        select: { columnId: true },
      });
      const updated = await tx.card.update({
        where: { id: cardId },
        data: { columnId: input.columnId, position },
        select: cardSelect,
      });
      // Solo los cambios de columna son relevantes para el análisis (no los reordenamientos).
      if (before.columnId !== input.columnId) {
        await tx.cardEvent.create({
          data: {
            boardId,
            cardId,
            type: 'moved',
            fromColumnId: before.columnId,
            toColumnId: input.columnId,
          },
        });
      }
      return updated;
      },
      // Reordenar una columna grande toma más que los 5 s por defecto.
      { timeout: 20_000, maxWait: 10_000 },
    ));

    if (!result) return notFound(reply, 'La columna');
    notify.cardUpdated(req, boardId, result);
    if (rebalanced) notify.boardReordered(boardId);
    return result;
  });

  app.delete<{ Params: { id: string } }>('/cards/:id', async (req, reply) => {
    const boardId = await boardIdOfCard(req.params.id);
    if (!boardId) return notFound(reply, 'La tarjeta');
    if (!(await requireBoardRole(reply, boardId, req.user.sub))) return;

    await prisma.$transaction(async (tx) => {
      const card = await tx.card.findUnique({
        where: { id: req.params.id },
        select: { columnId: true },
      });
      if (!card) return;
      await tx.card.delete({ where: { id: req.params.id } });
      await tx.cardEvent.create({
        data: { boardId, cardId: req.params.id, type: 'deleted', fromColumnId: card.columnId },
      });
    });
    notify.cardDeleted(req, boardId, req.params.id);
    return reply.code(204).send();
  });
}

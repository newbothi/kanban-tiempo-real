import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateNKeysBetween } from 'fractional-indexing';
import {
  addMemberSchema,
  createBoardSchema,
  type BoardDto,
  type BoardRole,
  type BoardSummaryDto,
  type MemberDto,
  type PendingInviteDto,
} from '@kanban/shared';
import { rejectIfDemo } from '../demo/demo';
import { SlidingWindowLimiter } from '../limits';
import { prisma } from '../db';
import { hashToken, limitWrites, newToken, notFound, parseOr400, publicUrl, rejectMalformedIds } from '../http';
import { invitationEmail, type Mailer } from '../mail';
import type { resolveLimits } from '../limits';
import { requireBoardRole } from '../auth/access';
import { notify } from '../realtime';
import { MlUnavailableError, analyzeBoard } from '../ml/client';
import {
  BoardTooLargeError,
  ML_LIMITS,
  MetricsRateLimitError,
  MetricsService,
} from '../ml/metrics';

const DEFAULT_COLUMNS = ['Por hacer', 'En progreso', 'Hecho'];

export interface RouteOptions {
  limits: ReturnType<typeof resolveLimits>;
  writes: SlidingWindowLimiter;
}

const MAX_PENDING_INVITES = 50;
const INVITE_ACCEPTED_MESSAGE = 'Si el correo corresponde a una cuenta, la persona verá la invitación al entrar.';
const INVITE_EMAIL_MESSAGE = 'Invitación enviada. Le llegará un correo con un enlace para verla y aceptarla.';

const INVITE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function boardRoutes(
  app: FastifyInstance,
  opts: RouteOptions & { metrics?: MetricsService; mailer: Mailer },
) {
  const metrics = opts.metrics ?? new MetricsService();
  const invitesSent = new SlidingWindowLimiter(20, 60 * 60 * 1000); // invitaciones por dueño y hora
  app.addHook('preValidation', rejectMalformedIds);

  // Todas las rutas de este plugin requieren sesión.
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', limitWrites(opts.writes));

  // Mis tableros (donde soy miembro o dueño)
  app.get('/boards', async (req): Promise<BoardSummaryDto[]> => {
    const memberships = await prisma.boardMember.findMany({
      where: { userId: req.user.sub },
      select: { role: true, board: { select: { id: true, name: true, createdAt: true } } },
      orderBy: { board: { createdAt: 'asc' } },
    });
    return memberships.map((m) => ({
      id: m.board.id,
      name: m.board.name,
      role: m.role as BoardRole,
    }));
  });

  // Crear tablero: quien lo crea queda como owner
  app.post('/boards', async (req, reply) => {
    const input = parseOr400(createBoardSchema, req.body, reply);
    if (!input) return;

    // S-16: tope de tableros propios por usuario.
    const owned = await prisma.boardMember.count({ where: { userId: req.user.sub, role: 'owner' } });
    if (owned >= opts.limits.boardsPerOwner) {
      return reply.code(403).send({
        error: 'QuotaExceeded',
        message: `Puedes tener hasta ${opts.limits.boardsPerOwner} tableros propios; elimina alguno para crear otro`,
      });
    }

    const keys = generateNKeysBetween(null, null, DEFAULT_COLUMNS.length);
    const board = await prisma.board.create({
      data: {
        name: input.name,
        columns: { create: DEFAULT_COLUMNS.map((title, i) => ({ title, position: keys[i] })) },
        members: { create: { userId: req.user.sub, role: 'owner' } },
      },
      select: { id: true, name: true },
    });
    return reply.code(201).send({ ...board, role: 'owner' } satisfies BoardSummaryDto);
  });

  // Tablero completo
  app.get<{ Params: { id: string } }>('/boards/:id', async (req, reply) => {
    const role = await requireBoardRole(reply, req.params.id, req.user.sub);
    if (!role) return;

    const board = await prisma.board.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        columns: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            boardId: true,
            title: true,
            position: true,
            cards: {
              orderBy: { position: 'asc' },
              select: { id: true, columnId: true, title: true, position: true },
            },
          },
        },
      },
    });
    if (!board) return notFound(reply, 'El tablero');

    const dto: BoardDto = {
      id: board.id,
      name: board.name,
      role,
      columns: board.columns.map(({ cards: _cards, ...col }) => col),
      cards: board.columns.flatMap((col) => col.cards),
    };
    return dto;
  });

  // Eliminar tablero: solo el dueño
  app.delete<{ Params: { id: string } }>('/boards/:id', async (req, reply) => {
    if (!(await requireBoardRole(reply, req.params.id, req.user.sub, 'owner'))) return;

    if (await rejectIfDemo(reply, req.user.sub, 'eliminar tableros')) return;
    const members = await prisma.boardMember.findMany({
      where: { boardId: req.params.id },
      select: { userId: true },
    });
    await prisma.board.delete({ where: { id: req.params.id } });
    notify.boardRemoved(req.params.id, members.map((m) => m.userId));
    return reply.code(204).send();
  });

  // ---- Métricas (servicio ML en Python) ----

  app.get<{ Params: { id: string } }>('/boards/:id/metrics', async (req, reply) => {
    const boardId = req.params.id;
    if (!(await requireBoardRole(reply, boardId, req.user.sub))) return;

    // "Versión" del tablero: cambia cada vez que se crea, mueve de columna o borra una tarjeta.
    // Mientras no cambie, se reutiliza el último análisis (S-05).
    const [stats, cardCount] = await Promise.all([
      prisma.cardEvent.aggregate({ where: { boardId }, _count: { _all: true }, _max: { at: true } }),
      prisma.card.count({ where: { column: { boardId } } }),
    ]);
    const tooLarge = () =>
      reply.code(422).send({
        error: 'BoardTooLarge',
        message: `El tablero es demasiado grande para analizarlo (máximo ${ML_LIMITS.cards} tarjetas)`,
      });
    if (cardCount > ML_LIMITS.cards || stats._count._all > ML_LIMITS.eventsScanned) return tooLarge();
    const version = `${stats._count._all}:${stats._max.at?.getTime() ?? 0}:${cardCount}`;

    try {
      return await metrics.get(boardId, req.user.sub, version, () => computeMetrics(boardId));
    } catch (err) {
      if (err instanceof BoardTooLargeError) return tooLarge();
      if (err instanceof MetricsRateLimitError) {
        return reply
          .code(429)
          .header('retry-after', String(err.retryAfterSec))
          .send({ error: 'TooManyRequests', message: 'Demasiados cálculos seguidos; vuelve a intentar en un minuto' });
      }
      if (!(err instanceof MlUnavailableError)) throw err;
      req.log.warn({ err }, 'servicio ML no disponible');
      return reply
        .code(503)
        .send({ error: 'MlUnavailable', message: 'El servicio de análisis no está disponible en este momento' });
    }
  });

  // ---- Miembros ----

  app.get<{ Params: { id: string } }>('/boards/:id/members', async (req, reply) => {
    if (!(await requireBoardRole(reply, req.params.id, req.user.sub))) return;

    const members = await prisma.boardMember.findMany({
      where: { boardId: req.params.id },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map(
      (m): MemberDto => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role as BoardRole,
      }),
    );
  });

  /**
   * Invitar por correo (S-08): solo el dueño. Se guarda una invitación PENDIENTE que la
   * persona acepta o rechaza. La respuesta es siempre la misma (202), exista o no la
   * cuenta, ya sea miembro o ya esté invitada: así no se puede averiguar qué correos
   * están registrados.
   */
  app.post<{ Params: { id: string } }>('/boards/:id/members', async (req, reply) => {
    const boardId = req.params.id;
    if (!(await requireBoardRole(reply, boardId, req.user.sub, 'owner'))) return;
    if (await rejectIfDemo(reply, req.user.sub, 'invitar personas')) return;
    const input = parseOr400(addMemberSchema, req.body, reply);
    if (!input) return;

    const wait = invitesSent.take(req.user.sub);
    if (wait > 0) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil(wait / 1000)))
        .send({ error: 'TooManyRequests', message: 'Enviaste muchas invitaciones; espera un rato' });
    }
    const pending = await prisma.boardInvite.count({ where: { boardId } });
    if (pending >= MAX_PENDING_INVITES) {
      return reply.code(403).send({
        error: 'QuotaExceeded',
        message: `El tablero tiene ${MAX_PENDING_INVITES} invitaciones sin responder; cancela alguna primero`,
      });
    }

    const invitee = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const alreadyMember =
      invitee && (await prisma.boardMember.findUnique({ where: { boardId_userId: { boardId, userId: invitee.id } } }));
    if (!alreadyMember) {
      try {
        await prisma.boardInvite.create({ data: { boardId, email: input.email, invitedById: req.user.sub } });
      } catch (err) {
        // Ya estaba invitada (índice único boardId + email): no es un error para quien invita.
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
      await emailInvitation(req, boardId, input.email);
      if (invitee) notify.invitesChanged(invitee.id);
      notify.pendingInvitesChanged(boardId);
    }
    // Igual exista o no la cuenta; solo cambia según si hay envío de correos configurado.
    return reply.code(202).send({ message: opts.mailer.enabled ? INVITE_EMAIL_MESSAGE : INVITE_ACCEPTED_MESSAGE });
  });

  /**
   * Manda (o vuelve a mandar) el correo con el enlace de la invitación. El enlace lleva un
   * token aleatorio nuevo; en la base queda solo su hash. Si el correo falla, la invitación
   * sigue valiendo: la persona la ve igual al entrar a la app.
   */
  async function emailInvitation(req: FastifyRequest, boardId: string, email: string) {
    if (!opts.mailer.enabled) return;
    const token = newToken();
    const invite = await prisma.boardInvite.update({
      where: { boardId_email: { boardId, email } },
      data: { tokenHash: hashToken(token), tokenExpiresAt: new Date(Date.now() + INVITE_LINK_TTL_MS) },
      select: { board: { select: { name: true } } },
    });
    const inviter = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { name: true } });
    const link = `${publicUrl(req)}/?invitacion=${token}`;
    try {
      await opts.mailer.send({ to: email, ...invitationEmail(inviter?.name ?? 'Alguien', invite.board.name, link) });
    } catch (err) {
      req.log.error({ err }, 'no se pudo enviar el correo de invitación');
    }
  }

  // Invitaciones sin responder de un tablero (solo el dueño las ve).
  app.get<{ Params: { id: string } }>('/boards/:id/invites', async (req, reply) => {
    if (!(await requireBoardRole(reply, req.params.id, req.user.sub, 'owner'))) return;
    const invites = await prisma.boardInvite.findMany({
      where: { boardId: req.params.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, createdAt: true },
    });
    return invites.map((i): PendingInviteDto => ({ ...i, createdAt: i.createdAt.toISOString() }));
  });

  // Cancelar una invitación que todavía nadie respondió.
  app.delete<{ Params: { id: string; inviteId: string } }>('/boards/:id/invites/:inviteId', async (req, reply) => {
    if (!(await requireBoardRole(reply, req.params.id, req.user.sub, 'owner'))) return;
    const invite = await prisma.boardInvite.findFirst({
      where: { id: req.params.inviteId, boardId: req.params.id },
      select: { email: true },
    });
    if (!invite) return notFound(reply, 'La invitación');
    await prisma.boardInvite.delete({ where: { id: req.params.inviteId } });
    const invitee = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    if (invitee) notify.invitesChanged(invitee.id);
    notify.pendingInvitesChanged(req.params.id);
    return reply.code(204).send();
  });

  // Quitar miembro: el dueño puede quitar a cualquiera (menos a sí mismo);
  // un miembro puede salirse por su cuenta.
  app.delete<{ Params: { id: string; userId: string } }>(
    '/boards/:id/members/:userId',
    async (req, reply) => {
      const { id: boardId, userId } = req.params;
      const me = req.user.sub;
      const myRole = await requireBoardRole(reply, boardId, me);
      if (!myRole) return;

      const leavingMyself = userId === me;
      if (!leavingMyself && (await rejectIfDemo(reply, me, 'quitar miembros'))) return;
      if (!leavingMyself && myRole !== 'owner') {
        return reply
          .code(403)
          .send({ error: 'Forbidden', message: 'Solo el dueño puede quitar miembros' });
      }
      if (leavingMyself && myRole === 'owner') {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'El dueño no puede salir de su tablero; elimínalo si ya no lo necesitas',
        });
      }

      const { count } = await prisma.boardMember.deleteMany({ where: { boardId, userId } });
      if (count === 0) return notFound(reply, 'El miembro');

      notify.memberRemoved(boardId, userId);
      return reply.code(204).send();
    },
  );
}

/** Reúne los datos del tablero (ya autorizado) y pide el análisis al servicio ML. */
async function computeMetrics(boardId: string) {
  const [columns, cards, events] = await Promise.all([
    prisma.column.findMany({ where: { boardId }, select: { id: true, title: true, position: true } }),
    prisma.card.findMany({
      where: { column: { boardId } },
      select: { id: true, title: true, columnId: true, createdAt: true },
    }),
    prisma.cardEvent.findMany({
      where: { boardId },
      orderBy: { at: 'asc' },
      select: { cardId: true, type: true, fromColumnId: true, toColumnId: true, at: true },
      take: ML_LIMITS.eventsScanned,
    }),
  ]);
  // Los eventos de tarjetas ya borradas no aportan al análisis: no se envían.
  const alive = new Set(cards.map((c) => c.id));
  const relevant = events.filter((e) => alive.has(e.cardId));
  if (cards.length > ML_LIMITS.cards || relevant.length > ML_LIMITS.events) throw new BoardTooLargeError();

  return analyzeBoard({
    now: new Date().toISOString(),
    columns,
    cards: cards.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    events: relevant.map((e) => ({
      ...e,
      type: e.type as 'created' | 'moved' | 'deleted',
      at: e.at.toISOString(),
    })),
  });
}

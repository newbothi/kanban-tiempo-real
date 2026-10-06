import type { FastifyInstance } from 'fastify';
import { generateNKeysBetween } from 'fractional-indexing';
import {
  addMemberSchema,
  createBoardSchema,
  type BoardDto,
  type BoardRole,
  type BoardSummaryDto,
  type MemberDto,
} from '@kanban/shared';
import { prisma } from '../db';
import { notFound, parseOr400 } from '../http';
import { requireBoardRole } from '../auth/access';
import { notify } from '../realtime';

const DEFAULT_COLUMNS = ['Por hacer', 'En progreso', 'Hecho'];

export async function boardRoutes(app: FastifyInstance) {
  // Todas las rutas de este plugin requieren sesión.
  app.addHook('preHandler', app.authenticate);

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

    const members = await prisma.boardMember.findMany({
      where: { boardId: req.params.id },
      select: { userId: true },
    });
    await prisma.board.delete({ where: { id: req.params.id } });
    notify.boardRemoved(req.params.id, members.map((m) => m.userId));
    return reply.code(204).send();
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

  // Invitar por correo: solo el dueño. El usuario debe estar registrado.
  app.post<{ Params: { id: string } }>('/boards/:id/members', async (req, reply) => {
    if (!(await requireBoardRole(reply, req.params.id, req.user.sub, 'owner'))) return;
    const input = parseOr400(addMemberSchema, req.body, reply);
    if (!input) return;

    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'No hay ningún usuario registrado con ese correo' });
    }

    const already = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: req.params.id, userId: user.id } },
    });
    if (already) {
      return reply.code(409).send({ error: 'Conflict', message: 'Ya es miembro del tablero' });
    }

    await prisma.boardMember.create({
      data: { boardId: req.params.id, userId: user.id, role: 'member' },
    });
    notify.memberAdded(req.params.id, user.id);
    return reply
      .code(201)
      .send({ userId: user.id, name: user.name, email: user.email, role: 'member' } satisfies MemberDto);
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

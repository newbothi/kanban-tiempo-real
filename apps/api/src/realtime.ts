import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  SOCKET_ID_HEADER,
  boardRoom,
  userRoom,
  type CardDto,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@kanban/shared';
import { roleIn } from './auth/access';

interface SocketData {
  userId: string;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
let io: IO | null = null;

/** Conecta Socket.IO al mismo servidor HTTP de Fastify (mismo puerto 3000). */
export function attachRealtime(app: FastifyInstance) {
  io = new Server(app.server, {
    cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true },
  });

  // Autenticación del handshake: el navegador envía la cookie de sesión al conectarse.
  // Si no hay sesión válida, se rechaza la conexión (el cliente recibe connect_error).
  io.use((socket, next) => {
    try {
      // @fastify/cookie expone el mismo parser que usa la API HTTP.
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
      const token = cookies[SESSION_COOKIE];
      if (!token) return next(new Error('unauthorized'));
      const payload = app.jwt.verify<{ sub: string }>(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    app.log.info({ socketId: socket.id, userId }, 'socket conectado');

    // Room personal: para avisarle a este usuario aunque no esté mirando un tablero.
    void socket.join(userRoom(userId));

    socket.on('board:join', async (boardId, ack) => {
      if (!z.uuid().safeParse(boardId).success) return ack({ ok: false, error: 'boardId inválido' });

      // Un error aquí (p. ej. la BD caída) NO debe tumbar el proceso: lo capturamos.
      try {
        // Solo los miembros pueden escuchar los eventos del tablero.
        if (!(await roleIn(boardId, userId))) {
          return ack({ ok: false, error: 'Sin acceso a este tablero' });
        }
      } catch (err) {
        app.log.error(err, 'board:join falló');
        return ack({ ok: false, error: 'Error interno' });
      }

      // Un socket mira un tablero a la vez: sale de los anteriores.
      for (const room of socket.rooms) {
        if (room.startsWith('board:') && room !== boardRoom(boardId)) {
          await socket.leave(room);
          void emitPresence(room.slice('board:'.length));
        }
      }
      await socket.join(boardRoom(boardId));
      ack({ ok: true });
      void emitPresence(boardId);
    });

    socket.on('board:leave', async (boardId) => {
      await socket.leave(boardRoom(boardId));
      void emitPresence(boardId);
    });

    // 'disconnecting' se dispara ANTES de salir de las rooms, así sabemos en cuáles estaba.
    socket.on('disconnecting', () => {
      const boards = [...socket.rooms].filter((r) => r.startsWith('board:'));
      setImmediate(() => boards.forEach((r) => void emitPresence(r.slice('board:'.length))));
    });
  });

  return io;
}

async function emitPresence(boardId: string) {
  if (!io) return;
  const sockets = await io.in(boardRoom(boardId)).fetchSockets();
  // Contamos personas, no pestañas.
  const count = new Set(sockets.map((s) => s.data.userId)).size;
  io.to(boardRoom(boardId)).emit('board:presence', { boardId, count });
}

/** Room del tablero, excluyendo al socket que hizo el request (ya tiene el cambio). */
function targetFor(boardId: string, req: FastifyRequest) {
  if (!io) return null;
  const origin = req.headers[SOCKET_ID_HEADER];
  const room = io.to(boardRoom(boardId));
  return typeof origin === 'string' && origin ? room.except(origin) : room;
}

/** Saca todas las pestañas de un usuario de la room de un tablero. */
function kick(boardId: string, userIds: string[]) {
  if (!io) return;
  for (const uid of userIds) {
    io.to(userRoom(uid)).emit('board:removed', { boardId });
    io.to(userRoom(uid)).emit('boards:changed');
    io.in(userRoom(uid)).socketsLeave(boardRoom(boardId));
  }
}

export const notify = {
  cardCreated: (req: FastifyRequest, boardId: string, card: CardDto) =>
    targetFor(boardId, req)?.emit('card:created', card),
  cardUpdated: (req: FastifyRequest, boardId: string, card: CardDto) =>
    targetFor(boardId, req)?.emit('card:updated', card),
  cardDeleted: (req: FastifyRequest, boardId: string, id: string) =>
    targetFor(boardId, req)?.emit('card:deleted', { id }),

  memberAdded: (boardId: string, userId: string) => {
    io?.to(boardRoom(boardId)).emit('board:membersChanged', { boardId });
    io?.to(userRoom(userId)).emit('boards:changed');
  },
  memberRemoved: (boardId: string, userId: string) => {
    kick(boardId, [userId]);
    io?.to(boardRoom(boardId)).emit('board:membersChanged', { boardId });
    void emitPresence(boardId);
  },
  boardRemoved: (boardId: string, memberIds: string[]) => kick(boardId, memberIds),
};

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  SOCKET_ID_HEADER,
  boardRoom,
  userRoom,
  type CardDto,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@kanban/shared';
import { roleIn } from './auth/access';
import { isSessionCurrent, sessionCookieName, type SessionClaims } from './auth/session';
import { allowedOrigins } from './origins';

interface SocketData {
  userId: string;
}

/** Máximo que acepta setTimeout (~24,8 días); las sesiones duran 7. */
const MAX_TIMER_MS = 2 ** 31 - 1;

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
let io: IO | null = null;

/** Conecta Socket.IO al mismo servidor HTTP de Fastify (mismo puerto 3000). */
export function attachRealtime(app: FastifyInstance) {
  const origins = allowedOrigins();
  io = new Server(app.server, {
    cors: origins.length ? { origin: origins, credentials: true } : undefined,
    // S-15: un sitio ajeno no puede abrir un WebSocket con la sesión de la víctima
    // (Cross-Site WebSocket Hijacking). Se acepta el mismo origen o uno configurado;
    // sin cabecera Origin (clientes que no son navegadores) no hay cookie ajena que robar.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      let sameHost = false;
      try {
        sameHost = new URL(origin).host === req.headers.host;
      } catch {
        // Origin mal formado
      }
      callback(null, sameHost || origins.includes(origin));
    },
  });

  // Autenticación del handshake: el navegador envía la cookie de sesión al conectarse.
  // Si no hay sesión válida (o se cerró), se rechaza la conexión (connect_error).
  io.use(async (socket, next) => {
    try {
      // @fastify/cookie expone el mismo parser que usa la API HTTP.
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
      const token = cookies[sessionCookieName()];
      if (!token) return next(new Error('unauthorized'));
      const claims = app.jwt.verify<SessionClaims>(token);
      if (!(await isSessionCurrent(claims))) return next(new Error('unauthorized'));
      socket.data.userId = claims.sub;
      // S-10: el socket no vive más que su sesión. Al vencer el token se corta.
      if (claims.exp) {
        const ms = Math.min(claims.exp * 1000 - Date.now(), MAX_TIMER_MS);
        const timer = setTimeout(() => {
          socket.emit('session:ended');
          socket.disconnect(true);
        }, Math.max(ms, 0));
        socket.once('disconnect', () => clearTimeout(timer));
      }
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
      // El cliente puede emitir sin callback (por error o a propósito): llamar a un `ack`
      // inexistente lanzaba un TypeError que tumbaba el proceso entero (S-01).
      const reply = typeof ack === 'function' ? ack : () => {};
      // Todo el handler va protegido: un error aquí (BD caída, socket cerrado…) se registra
      // y se responde, nunca se propaga.
      try {
        if (!z.uuid().safeParse(boardId).success) return reply({ ok: false, error: 'boardId inválido' });

        // Solo los miembros pueden escuchar los eventos del tablero.
        if (!(await roleIn(boardId, userId))) {
          return reply({ ok: false, error: 'Sin acceso a este tablero' });
        }

        // Un socket mira un tablero a la vez: sale de los anteriores.
        for (const room of socket.rooms) {
          if (room.startsWith('board:') && room !== boardRoom(boardId)) {
            await socket.leave(room);
            void emitPresence(room.slice('board:'.length));
          }
        }
        await socket.join(boardRoom(boardId));
        reply({ ok: true });
        void emitPresence(boardId);
      } catch (err) {
        app.log.error(err, 'board:join falló');
        reply({ ok: false, error: 'Error interno' });
      }
    });

    socket.on('board:leave', async (boardId) => {
      try {
        if (!z.uuid().safeParse(boardId).success) return;
        await socket.leave(boardRoom(boardId));
        void emitPresence(boardId);
      } catch (err) {
        app.log.error(err, 'board:leave falló');
      }
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
  try {
    const sockets = await io.in(boardRoom(boardId)).fetchSockets();
    // Contamos personas, no pestañas.
    const count = new Set(sockets.map((s) => s.data.userId)).size;
    io.to(boardRoom(boardId)).emit('board:presence', { boardId, count });
  } catch {
    // La presencia es informativa: si falla, no se interrumpe nada.
  }
}

/** Room del tablero, excluyendo al socket que hizo el request (ya tiene el cambio). */
function targetFor(boardId: string, req: FastifyRequest) {
  if (!io) return null;
  const origin = req.headers[SOCKET_ID_HEADER];
  const room = io.to(boardRoom(boardId));
  return typeof origin === 'string' && origin ? room.except(origin) : room;
}

/** Cierra la sesión en todas las pestañas del usuario: les avisa y corta sus sockets (S-10). */
export function endSessions(userId: string) {
  if (!io) return;
  io.to(userRoom(userId)).emit('session:ended');
  io.in(userRoom(userId)).disconnectSockets(true);
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

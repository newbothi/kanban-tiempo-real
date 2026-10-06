import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@kanban/shared';

/**
 * Un único socket para toda la app.
 * Se conecta al mismo origen (localhost:5173) y Vite redirige /socket.io a la API.
 * El navegador envía la cookie de sesión en el handshake: el servidor sabe quién eres.
 * No se conecta solo: solo cuando hay sesión (ver connectSocket).
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  path: '/socket.io',
  transports: ['websocket'],
  withCredentials: true,
  autoConnect: false,
});

/** (Re)conecta. Tras un login hay que reconectar para que el handshake lleve la cookie nueva. */
export function connectSocket() {
  if (socket.connected) socket.disconnect();
  socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}

/** Conecta solo si no está conectado ni intentando conectar. */
export function ensureSocket() {
  if (!socket.active) socket.connect();
}

import type { CardDto } from './types';

// Contrato de eventos de Socket.IO. Lo usan el servidor y el cliente,
// así que si cambias un evento aquí, TypeScript te avisa en ambos lados.

/** Eventos que el servidor envía a los clientes. */
export interface ServerToClientEvents {
  'card:created': (card: CardDto) => void;
  'card:updated': (card: CardDto) => void; // movida o renombrada
  'card:deleted': (payload: { id: string }) => void;
  /** Cuántas pestañas/usuarios están viendo el tablero. */
  'board:presence': (payload: { boardId: string; count: number }) => void;
  /** Cambió la lista de miembros de un tablero que estás viendo. */
  'board:membersChanged': (payload: { boardId: string }) => void;
  /** Perdiste acceso a un tablero (te sacaron o lo eliminaron). */
  'board:removed': (payload: { boardId: string }) => void;
  /** Cambió tu lista de tableros (p. ej. te invitaron a uno). */
  'boards:changed': () => void;
}

/** Eventos que el cliente envía al servidor. */
export interface ClientToServerEvents {
  'board:join': (boardId: string, ack: (res: { ok: boolean; error?: string }) => void) => void;
  'board:leave': (boardId: string) => void;
}

/** Header HTTP con el id del socket que originó un cambio (para no reenviárselo). */
export const SOCKET_ID_HEADER = 'x-socket-id';

export const boardRoom = (boardId: string) => `board:${boardId}`;
/** Room personal: todas las pestañas abiertas de un mismo usuario. */
export const userRoom = (userId: string) => `user:${userId}`;

/** Nombre de la cookie de sesión (httpOnly, la pone la API). */
export const SESSION_COOKIE = 'kanban_session';

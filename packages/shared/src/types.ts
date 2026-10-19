// Tipos compartidos entre la API y el front. Son el "contrato" del sistema.

export interface ColumnDto {
  id: string;
  boardId: string;
  title: string;
  position: string;
}

export interface CardDto {
  id: string;
  columnId: string;
  title: string;
  position: string;
}

export type BoardRole = 'owner' | 'member';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  /** S-09: si el correo ya fue confirmado. */
  emailVerified: boolean;
  /** Si el servidor exige verificar el correo para aceptar invitaciones (hay envío de correos configurado). */
  verificationRequired: boolean;
  /** S-18: la cuenta demo pública tiene acciones restringidas. */
  isDemo: boolean;
}

/** Invitación que recibí y todavía no respondo. */
export interface InviteDto {
  id: string;
  boardId: string;
  boardName: string;
  invitedBy: string;
  createdAt: string;
}

/** Invitación enviada a un tablero mío, todavía sin respuesta. */
export interface PendingInviteDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface BoardSummaryDto {
  id: string;
  name: string;
  /** Rol del usuario actual en este tablero. */
  role: BoardRole;
}

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: BoardRole;
}

export interface BoardDto extends BoardSummaryDto {
  columns: ColumnDto[];
  cards: CardDto[];
}

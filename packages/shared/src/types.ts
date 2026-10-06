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

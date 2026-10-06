import type { BoardDto, CardDto } from './types';
import { keyAtIndex, sortByPosition } from './ordering';

/** Tarjetas de una columna, ordenadas. */
export function cardsOf<T extends Pick<CardDto, 'columnId' | 'position'>>(
  cards: T[],
  columnId: string,
): T[] {
  return sortByPosition(cards.filter((c) => c.columnId === columnId));
}

/**
 * Calcula la nueva position de una tarjeta movida a `columnId` en `index`.
 * La usan tanto el servidor (valor definitivo) como el front (actualización optimista).
 */
export function positionForMove(
  cards: Pick<CardDto, 'id' | 'columnId' | 'position'>[],
  cardId: string,
  columnId: string,
  index: number,
): string {
  const target = cardsOf(cards, columnId).filter((c) => c.id !== cardId);
  return keyAtIndex(target, index);
}

/** Aplica un movimiento sobre un tablero sin mutarlo (útil para el estado optimista). */
export function applyMove(board: BoardDto, cardId: string, columnId: string, index: number): BoardDto {
  const position = positionForMove(board.cards, cardId, columnId, index);
  return {
    ...board,
    cards: board.cards.map((c) => (c.id === cardId ? { ...c, columnId, position } : c)),
  };
}

/** Inserta o reemplaza una tarjeta (para aplicar eventos que llegan del servidor). */
export function upsertCard(board: BoardDto, card: CardDto): BoardDto {
  const exists = board.cards.some((c) => c.id === card.id);
  return {
    ...board,
    cards: exists ? board.cards.map((c) => (c.id === card.id ? card : c)) : [...board.cards, card],
  };
}

export function removeCard(board: BoardDto, cardId: string): BoardDto {
  return { ...board, cards: board.cards.filter((c) => c.id !== cardId) };
}

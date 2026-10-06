import { describe, expect, it } from 'vitest';
import { applyMove, cardsOf, positionForMove, removeCard, upsertCard } from '../src/board';
import type { BoardDto } from '../src/types';

const board: BoardDto = {
  id: 'b',
  name: 'Tablero',
  role: 'owner',
  columns: [
    { id: 'todo', boardId: 'b', title: 'Por hacer', position: 'a0' },
    { id: 'done', boardId: 'b', title: 'Hecho', position: 'a1' },
  ],
  cards: [
    { id: 'c1', columnId: 'todo', title: 'Uno', position: 'a0' },
    { id: 'c2', columnId: 'todo', title: 'Dos', position: 'a1' },
    { id: 'c3', columnId: 'todo', title: 'Tres', position: 'a2' },
    { id: 'c4', columnId: 'done', title: 'Cuatro', position: 'a0' },
  ],
};
const titles = (b: BoardDto, col: string) => cardsOf(b.cards, col).map((c) => c.title);

describe('applyMove', () => {
  it('reordena dentro de la misma columna', () => {
    const moved = applyMove(board, 'c3', 'todo', 0);
    expect(titles(moved, 'todo')).toEqual(['Tres', 'Uno', 'Dos']);
  });

  it('mueve a otra columna en el índice pedido', () => {
    const moved = applyMove(board, 'c1', 'done', 1);
    expect(titles(moved, 'todo')).toEqual(['Dos', 'Tres']);
    expect(titles(moved, 'done')).toEqual(['Cuatro', 'Uno']);
  });

  it('mueve a una columna vacía', () => {
    const empty: BoardDto = { ...board, cards: board.cards.filter((c) => c.columnId === 'todo') };
    const moved = applyMove(empty, 'c2', 'done', 0);
    expect(titles(moved, 'done')).toEqual(['Dos']);
  });

  it('solo cambia la tarjeta movida (las demás conservan su position)', () => {
    const moved = applyMove(board, 'c3', 'todo', 1);
    const changed = moved.cards.filter(
      (c) => c.position !== board.cards.find((o) => o.id === c.id)!.position,
    );
    expect(changed.map((c) => c.id)).toEqual(['c3']);
  });

  it('no muta el tablero original', () => {
    applyMove(board, 'c1', 'done', 0);
    expect(board.cards[0].columnId).toBe('todo');
  });

  it('cliente y servidor calculan la misma position', () => {
    // El servidor llama positionForMove con las tarjetas de la columna destino;
    // el cliente aplica applyMove sobre todo el tablero. Deben coincidir.
    const server = positionForMove(
      board.cards.filter((c) => c.columnId === 'done'),
      'c2',
      'done',
      0,
    );
    const client = applyMove(board, 'c2', 'done', 0).cards.find((c) => c.id === 'c2')!.position;
    expect(client).toBe(server);
  });
});

describe('upsertCard / removeCard', () => {
  it('upsert reemplaza una existente', () => {
    const b = upsertCard(board, { ...board.cards[0], title: 'Renombrada' });
    expect(b.cards).toHaveLength(4);
    expect(b.cards[0].title).toBe('Renombrada');
  });

  it('upsert agrega una nueva', () => {
    const b = upsertCard(board, { id: 'c5', columnId: 'done', title: 'Cinco', position: 'a1' });
    expect(titles(b, 'done')).toEqual(['Cuatro', 'Cinco']);
  });

  it('removeCard elimina por id', () => {
    expect(removeCard(board, 'c2').cards.map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);
  });
});

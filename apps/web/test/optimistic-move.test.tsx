import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { BoardDto } from '@kanban/shared';
import { keys, useBoard, useMoveCard } from '../src/api/queries';
import { createQueryClient } from '../src/api/queryClient';
import { Toaster } from '../src/ui/toast';
import { installApi, reply } from './fake-api';
import { makeBoard } from './fixtures';

function setup(moveHandler: () => unknown, initial: BoardDto = makeBoard()) {
  const api = installApi({ 'POST /cards/:id/move': moveHandler, 'GET /boards/:id': () => makeBoard() });
  const client = createQueryClient({ retry: 0 });
  client.setQueryData(keys.board('b-1'), initial);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
  // Como en la app, el tablero está en pantalla (useBoard): por eso se vuelve a pedir al terminar.
  const { result } = renderHook(
    () => {
      useBoard('b-1');
      return useMoveCard('b-1');
    },
    { wrapper },
  );
  const board = () => client.getQueryData<BoardDto>(keys.board('b-1'))!;
  const columnOf = (id: string) => board().cards.find((c) => c.id === id)?.columnId;
  return { api, move: result.current, board, columnOf };
}

describe('mover tarjeta (actualización optimista)', () => {
  it('la caché cambia en el mismo instante, antes de que responda la API', () => {
    const { move, columnOf } = setup(() => new Promise(() => {})); // la API nunca responde
    act(() => move('k-1', { columnId: 'c-done', index: 0 }));
    expect(columnOf('k-1')).toBe('c-done');
  });

  it('manda a la API la columna y el índice de destino', async () => {
    const { move, api } = setup(() => ({ id: 'k-1', columnId: 'c-doing', title: 'Diseñar login', position: 'Zz' }));
    act(() => move('k-1', { columnId: 'c-doing', index: 0 }));
    await waitFor(() => expect(api.callsTo('POST /cards/k-1/move')).toHaveLength(1));
    expect(api.callsTo('POST /cards/k-1/move')[0].body).toEqual({ columnId: 'c-doing', index: 0 });
  });

  it('si la API falla, se restaura la copia anterior y se avisa', async () => {
    const { move, columnOf } = setup(() => reply(500, { message: 'boom' }));
    act(() => move('k-1', { columnId: 'c-done', index: 0 }));
    expect(columnOf('k-1')).toBe('c-done');
    await waitFor(() => expect(columnOf('k-1')).toBe('c-todo'));
    expect(await screen.findByText(/No se pudo mover la tarjeta; volvió a su lugar/)).toBeInTheDocument();
  });

  it('al terminar (bien o mal) vuelve a pedir el tablero para quedar alineado', async () => {
    const { move, api } = setup(() => reply(409, { message: 'conflicto' }));
    act(() => move('k-1', { columnId: 'c-done', index: 0 }));
    await waitFor(() => expect(api.callsTo('GET /boards/b-1').length).toBeGreaterThan(0));
  });

  it('si las posiciones locales no permiten calcular el lugar, no toca la caché (el servidor lo corrige)', () => {
    const broken = makeBoard();
    broken.cards = [
      ...broken.cards,
      { id: 'k-4', columnId: 'c-done', title: 'Uno', position: 'a0' },
      { id: 'k-5', columnId: 'c-done', title: 'Dos', position: 'a0' }, // misma clave: no hay nada "entre" ambas
    ];
    const { move, board } = setup(() => new Promise(() => {}), broken);
    act(() => move('k-1', { columnId: 'c-done', index: 1 }));
    expect(board().cards.find((c) => c.id === 'k-1')?.columnId).toBe('c-todo');
  });
});

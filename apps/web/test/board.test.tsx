import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BoardDto, CardDto } from '@kanban/shared';
import { installApi, reply } from './fake-api';
import { fakeSocket } from './fake-socket';
import { ana, makeAnalysis, makeBoard } from './fixtures';
import { renderApp } from './render';

/** Un servidor en memoria: el tablero cambia con cada POST/DELETE, como el real. */
function workspaceApi(board: BoardDto = makeBoard(), extra: Parameters<typeof installApi>[0] = {}) {
  let state = structuredClone(board);
  let next = 100;
  const api = installApi({
    'GET /auth/me': () => ana,
    'GET /boards': () => [{ id: state.id, name: state.name, role: state.role }],
    'GET /boards/:id': () => state,
    'GET /boards/:id/metrics': () => makeAnalysis(),
    'GET /boards/:id/members': () => [{ userId: ana.id, name: 'Ana', email: ana.email, role: 'owner' }],
    'GET /boards/:id/invites': () => [],
    'GET /invites': () => [],
    'POST /cards': (body) => {
      const { columnId, title } = body as { columnId: string; title: string };
      const card: CardDto = { id: `k-${next++}`, columnId, title, position: 'z' };
      state = { ...state, cards: [...state.cards, card] };
      return card;
    },
    'DELETE /cards/:id': (_b, url) => {
      const id = url.pathname.split('/').pop();
      state = { ...state, cards: state.cards.filter((c) => c.id !== id) };
      return undefined;
    },
    'POST /auth/logout': () => undefined,
    ...extra,
  });
  return { api, get state() { return state; } };
}

const column = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement;

describe('tablero', () => {
  it('muestra las columnas en orden con sus tarjetas y contadores', async () => {
    workspaceApi();
    renderApp();
    await screen.findByText('Diseñar login');
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['Proyecto', 'Por hacer', 'En curso', 'Hecho']);
    expect(within(column('Por hacer')).getByText('2')).toBeInTheDocument();
    expect(within(column('Hecho')).getByText('Suelta tarjetas aquí')).toBeInTheDocument();
  });

  it('crear una tarjeta la agrega a su columna y limpia el campo', async () => {
    const { api } = workspaceApi();
    renderApp();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Nueva tarjeta en Hecho');
    await user.type(input, 'Publicar versión{Enter}');

    expect(await within(column('Hecho')).findByText('Publicar versión')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(api.callsTo('POST /cards')[0].body).toEqual({ columnId: 'c-done', title: 'Publicar versión' });
    // La API sabe quién hizo el cambio, para no reenviarle su propio evento.
    expect(api.callsTo('POST /cards')[0].headers['x-socket-id']).toBe('socket-de-prueba');
  });

  it('si crear falla, conserva el texto y avisa', async () => {
    workspaceApi(undefined, { 'POST /cards': () => reply(500, { message: 'boom' }) });
    renderApp();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Nueva tarjeta en Hecho');
    await user.type(input, 'Algo{Enter}');
    expect(await screen.findByText(/No se pudo crear la tarjeta. El servidor tuvo un problema/)).toBeInTheDocument();
    expect(input).toHaveValue('Algo');
  });

  it('borrar es optimista: la tarjeta desaparece al tiro', async () => {
    let release!: () => void;
    const { api } = workspaceApi(undefined, {
      'DELETE /cards/:id': () => new Promise((r) => (release = () => r(undefined))),
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Eliminar Diseñar login' }));
    expect(screen.queryByText('Diseñar login')).not.toBeInTheDocument(); // antes de que responda la API
    expect(api.callsTo('DELETE /cards/k-1')).toHaveLength(1);
    act(() => release());
  });

  it('si el servidor rechaza el borrado, la tarjeta vuelve a su lugar y se avisa', async () => {
    workspaceApi(undefined, {
      'DELETE /cards/:id': () => reply(403, { message: 'Solo el dueño del tablero puede hacer esto' }),
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Eliminar Diseñar login' }));
    expect(await screen.findByText(/No se pudo eliminar la tarjeta. Solo el dueño/)).toBeInTheDocument();
    expect(within(column('Por hacer')).getByText('Diseñar login')).toBeInTheDocument();
  });

  it('crear un tablero lo selecciona', async () => {
    let boards = [{ id: 'b-1', name: 'Proyecto', role: 'owner' }];
    workspaceApi(undefined, {
      'GET /boards': () => boards,
      'POST /boards': (body) => {
        const b = { id: 'b-2', name: (body as { name: string }).name, role: 'owner' };
        boards = [...boards, b];
        return b;
      },
      'GET /boards/:id': (_b, url) =>
        url.pathname.endsWith('b-2') ? makeBoard({ id: 'b-2', name: 'Nuevo', cards: [] }) : makeBoard(),
    });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nombre del nuevo tablero'), 'Nuevo{Enter}');
    expect(await screen.findByRole('heading', { name: 'Nuevo' })).toBeInTheDocument();
    expect(location.hash).toBe('#b-2');
  });

  it('sin tableros invita a crear uno', async () => {
    workspaceApi(undefined, { 'GET /boards': () => [] });
    renderApp();
    expect(await screen.findByText(/Aún no tienes tableros/)).toBeInTheDocument();
  });

  it('eliminar el tablero pide confirmación', async () => {
    const { api } = workspaceApi(undefined, { 'DELETE /boards/:id': () => undefined });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Eliminar tablero' }));
    expect(api.callsTo('DELETE /boards/b-1')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Eliminar tablero' }));
    await waitFor(() => expect(api.callsTo('DELETE /boards/b-1')).toHaveLength(1));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('cerrar sesión desconecta el socket y vuelve al login', async () => {
    const { api } = workspaceApi();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText('Diseñar login');
    expect(fakeSocket.connected).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(fakeSocket.connected).toBe(false);
    expect(api.callsTo('POST /auth/logout')).toHaveLength(1);
  });
});

describe('tiempo real', () => {
  it('entra a la room del tablero y aplica lo que hacen los demás', async () => {
    workspaceApi();
    renderApp();
    await screen.findByText('Diseñar login');
    await waitFor(() => expect(fakeSocket.emittedNames()).toContain('board:join'));

    act(() =>
      fakeSocket.serverEmit('card:created', { id: 'k-9', columnId: 'c-doing', title: 'De Beto', position: 'b' }),
    );
    // TanStack Query avisa a la UI en el siguiente tick: por eso find* y no get*.
    expect(await within(column('En curso')).findByText('De Beto')).toBeInTheDocument();

    act(() =>
      fakeSocket.serverEmit('card:updated', { id: 'k-9', columnId: 'c-done', title: 'De Beto', position: 'b' }),
    );
    expect(await within(column('Hecho')).findByText('De Beto')).toBeInTheDocument();

    act(() => fakeSocket.serverEmit('card:deleted', { id: 'k-9' }));
    await waitFor(() => expect(screen.queryByText('De Beto')).not.toBeInTheDocument());
  });

  it('muestra cuántas personas están viendo el tablero', async () => {
    workspaceApi();
    renderApp();
    expect(await screen.findByText(/En vivo · 1 conectado$/)).toBeInTheDocument();
    act(() => fakeSocket.serverEmit('board:presence', { boardId: 'b-1', count: 3 }));
    expect(screen.getByText(/3 conectados/)).toBeInTheDocument();
    act(() => fakeSocket.serverEmit('board:presence', { boardId: 'otro', count: 9 }));
    expect(screen.getByText(/3 conectados/)).toBeInTheDocument();
  });

  it('al perder la conexión lo indica, y al volver pide el tablero de nuevo', async () => {
    const { api } = workspaceApi();
    renderApp();
    await screen.findByText(/En vivo/);
    const before = api.callsTo('GET /boards/b-1').length;

    act(() => fakeSocket.drop());
    expect(screen.getByText('Sin conexión, reintentando…')).toBeInTheDocument();

    act(() => {
      fakeSocket.connected = true;
      fakeSocket.serverEmit('connect');
    });
    expect(await screen.findByText(/En vivo/)).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET /boards/b-1').length).toBeGreaterThan(before));
    expect(fakeSocket.emittedNames().filter((e) => e === 'board:join').length).toBeGreaterThanOrEqual(2);
  });

  it('si el servidor reordena una columna, recarga el tablero', async () => {
    const { api } = workspaceApi();
    renderApp();
    await screen.findByText(/En vivo/);
    const before = api.callsTo('GET /boards/b-1').length;
    act(() => fakeSocket.serverEmit('board:reordered', { boardId: 'b-1' }));
    await waitFor(() => expect(api.callsTo('GET /boards/b-1').length).toBe(before + 1));
  });

  it('si lo sacan del tablero, lo avisa y deja de mostrarlo', async () => {
    let boards = [{ id: 'b-1', name: 'Proyecto', role: 'member' }];
    workspaceApi(makeBoard({ role: 'member' }), { 'GET /boards': () => boards });
    renderApp();
    await screen.findByText('Diseñar login');
    boards = [];
    act(() => fakeSocket.serverEmit('board:removed', { boardId: 'b-1' }));
    expect(await screen.findByText(/fue eliminado o ya no tienes acceso/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Diseñar login')).not.toBeInTheDocument());
  });

  it('si la lista de tableros cambia, la vuelve a pedir', async () => {
    const { api } = workspaceApi();
    renderApp();
    await screen.findByText('Diseñar login');
    const before = api.callsTo('GET /boards').length;
    act(() => fakeSocket.serverEmit('boards:changed'));
    await waitFor(() => expect(api.callsTo('GET /boards').length).toBe(before + 1));
  });

  it('al salir del tablero se va de la room y suelta los listeners', async () => {
    workspaceApi();
    const { unmount } = renderApp();
    await screen.findByText(/En vivo/);
    expect(fakeSocket.listeners('card:created')).toBe(1);
    unmount();
    expect(fakeSocket.emittedNames()).toContain('board:leave');
    expect(fakeSocket.listeners('card:created')).toBe(0);
  });

  it('si no lo dejan entrar a la room, lo registra sin romper la vista', async () => {
    fakeSocket.joinReply = { ok: false, error: 'Sin acceso' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    workspaceApi();
    renderApp();
    await screen.findByText('Diseñar login');
    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('no se pudo entrar'), 'Sin acceso'));
  });
});

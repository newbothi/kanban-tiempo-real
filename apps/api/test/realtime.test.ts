import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connected,
  joinBoard,
  registerUser,
  resetDb,
  sleep,
  socketFor,
  startServer,
  waitForEvent,
} from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let ana: Awaited<ReturnType<typeof registerUser>>;
let beto: Awaited<ReturnType<typeof registerUser>>;
let sAna: ReturnType<typeof socketFor>;
let sBeto: ReturnType<typeof socketFor>;
let boardId: string;
let todo: string;
const sockets: ReturnType<typeof socketFor>[] = [];
const track = (s: ReturnType<typeof socketFor>) => (sockets.push(s), s);

beforeAll(async () => {
  await resetDb();
  server = await startServer();
  ana = await registerUser(server.base, 'Ana');
  beto = await registerUser(server.base, 'Beto');
  boardId = (await ana.req('POST', '/boards', { name: 'Tiempo real' })).data.id;
  todo = (await ana.req('GET', `/boards/${boardId}`)).data.columns[0].id;
  sAna = track(socketFor(server.base, ana.cookie));
  sBeto = track(socketFor(server.base, beto.cookie));
  await Promise.all([connected(sAna), connected(sBeto)]);
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await server.app.close();
});

describe('autenticación del socket', () => {
  it('rechaza conexiones sin sesión', async () => {
    expect(await connected(track(socketFor(server.base, '')))).toBe('error:unauthorized');
  });

  it('rechaza tokens falsificados', async () => {
    expect(await connected(track(socketFor(server.base, 'kanban_session=x.y.z')))).toBe('error:unauthorized');
  });
});

describe('rooms', () => {
  it('el dueño entra a su tablero', async () => {
    expect(await joinBoard(sAna, boardId)).toEqual({ ok: true });
  });

  it('un no miembro NO puede entrar ni recibir eventos', async () => {
    expect((await joinBoard(sBeto, boardId)).ok).toBe(false);
    await ana.req('POST', '/cards', { columnId: todo, title: 'Secreta' }, { 'x-socket-id': sAna.id! });
    await sleep(200);
    expect(sBeto.events.some(([e]) => e.startsWith('card:'))).toBe(false);
  });
});

describe('invitar y sincronizar', () => {
  it('al invitar, el usuario recibe boards:changed en su room personal', async () => {
    await ana.req('POST', `/boards/${boardId}/members`, { email: beto.email });
    await waitForEvent(sBeto, 'boards:changed');
    expect(await joinBoard(sBeto, boardId)).toEqual({ ok: true });
  });

  it('la presencia cuenta personas', async () => {
    const p = await waitForEvent(sAna, 'board:presence', (x) => x.count === 2);
    expect(p).toEqual({ boardId, count: 2 });
  });

  it('una segunda pestaña del mismo usuario no suma a la presencia', async () => {
    const tab2 = track(socketFor(server.base, beto.cookie));
    await connected(tab2);
    await joinBoard(tab2, boardId);
    await sleep(150);
    const last = sAna.events.filter(([e]) => e === 'board:presence').at(-1)?.[1];
    expect(last.count).toBe(2);
    tab2.close();
  });

  it('los cambios llegan a los demás, pero no a quien los hizo', async () => {
    sAna.events.length = 0;
    sBeto.events.length = 0;
    const card = (
      await beto.req('POST', '/cards', { columnId: todo, title: 'De Beto' }, { 'x-socket-id': sBeto.id! })
    ).data;
    const received = await waitForEvent(sAna, 'card:created', (c) => c.id === card.id);
    expect(received).toEqual(card);
    await sleep(150);
    expect(sBeto.events.some(([e]) => e === 'card:created')).toBe(false);
  });

  it('mover envía la tarjeta con la position calculada por el servidor', async () => {
    const card = (await ana.req('GET', `/boards/${boardId}`)).data.cards[0];
    const done = (await ana.req('GET', `/boards/${boardId}`)).data.columns[2].id;
    const r = await ana.req('POST', `/cards/${card.id}/move`, { columnId: done, index: 0 }, { 'x-socket-id': sAna.id! });
    const received = await waitForEvent(sBeto, 'card:updated', (c) => c.id === card.id);
    expect(received).toEqual(r.data);
  });
});

describe('perder el acceso', () => {
  it('al quitar a un miembro, se le avisa y deja de recibir eventos', async () => {
    sBeto.events.length = 0;
    await ana.req('DELETE', `/boards/${boardId}/members/${beto.id}`);
    await waitForEvent(sBeto, 'board:removed', (p) => p.boardId === boardId);

    sBeto.events.length = 0;
    await ana.req('POST', '/cards', { columnId: todo, title: 'Después' }, { 'x-socket-id': sAna.id! });
    await sleep(200);
    expect(sBeto.events.some(([e]) => e.startsWith('card:'))).toBe(false);
  });

  it('al eliminar el tablero, todos los miembros reciben board:removed', async () => {
    await ana.req('POST', `/boards/${boardId}/members`, { email: beto.email });
    await joinBoard(sBeto, boardId);
    sBeto.events.length = 0;
    await ana.req('DELETE', `/boards/${boardId}`);
    await waitForEvent(sBeto, 'board:removed', (p) => p.boardId === boardId);
  });
});

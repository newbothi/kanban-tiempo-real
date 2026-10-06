import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser, resetDb, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let ana: Awaited<ReturnType<typeof registerUser>>;
let beto: Awaited<ReturnType<typeof registerUser>>;
let boardId: string;
let todo: string;
let done: string;
let cardId: string;

beforeAll(async () => {
  await resetDb();
  server = await startServer();
  ana = await registerUser(server.base, 'Ana');
  beto = await registerUser(server.base, 'Beto');

  boardId = (await ana.req('POST', '/boards', { name: 'Proyecto de Ana' })).data.id;
  const board = (await ana.req('GET', `/boards/${boardId}`)).data;
  [todo, , done] = board.columns.map((c: { id: string }) => c.id);
  cardId = (await ana.req('POST', '/cards', { columnId: todo, title: 'Tarea' })).data.id;
});
afterAll(async () => {
  await server.app.close();
});

describe('sin sesión', () => {
  it.each([
    ['GET', '/boards'],
    ['POST', '/boards'],
    ['POST', '/cards'],
  ])('%s %s → 401', async (method, path) => {
    const r = await fetch(server.base + '/api' + path, { method });
    expect(r.status).toBe(401);
  });
});

describe('un usuario que NO es miembro', () => {
  it('no ve el tablero en su lista', async () => {
    expect((await beto.req('GET', '/boards')).data).toEqual([]);
  });

  it('recibe 404 (no 403) para no revelar que el tablero existe', async () => {
    expect((await beto.req('GET', `/boards/${boardId}`)).status).toBe(404);
    expect((await beto.req('GET', `/boards/${boardId}/members`)).status).toBe(404);
  });

  it('no puede crear, mover, renombrar ni borrar tarjetas', async () => {
    expect((await beto.req('POST', '/cards', { columnId: todo, title: 'x' })).status).toBe(404);
    expect((await beto.req('POST', `/cards/${cardId}/move`, { columnId: done, index: 0 })).status).toBe(404);
    expect((await beto.req('PATCH', `/cards/${cardId}`, { title: 'hackeada' })).status).toBe(404);
    expect((await beto.req('DELETE', `/cards/${cardId}`)).status).toBe(404);
    // y la tarjeta sigue intacta
    const card = (await ana.req('GET', `/boards/${boardId}`)).data.cards[0];
    expect(card).toMatchObject({ id: cardId, title: 'Tarea', columnId: todo });
  });

  it('no puede invitarse a sí mismo', async () => {
    expect((await beto.req('POST', `/boards/${boardId}/members`, { email: beto.email })).status).toBe(404);
  });
});

describe('invitaciones', () => {
  it('solo a usuarios registrados', async () => {
    const r = await ana.req('POST', `/boards/${boardId}/members`, { email: 'nadie@test.cl' });
    expect(r.status).toBe(404);
  });

  it('el dueño invita a un miembro', async () => {
    const r = await ana.req('POST', `/boards/${boardId}/members`, { email: beto.email.toUpperCase() });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ userId: beto.id, role: 'member' });
    expect((await ana.req('POST', `/boards/${boardId}/members`, { email: beto.email })).status).toBe(409);
  });

  it('el miembro ahora ve el tablero', async () => {
    expect((await beto.req('GET', '/boards')).data).toEqual([
      { id: boardId, name: 'Proyecto de Ana', role: 'member' },
    ]);
  });
});

describe('un miembro', () => {
  it('puede trabajar con las tarjetas', async () => {
    const r = await beto.req('POST', `/cards/${cardId}/move`, { columnId: done, index: 0 });
    expect(r.status).toBe(200);
    expect(r.data.columnId).toBe(done);
  });

  it('no puede invitar, quitar al dueño ni eliminar el tablero (403)', async () => {
    expect((await beto.req('POST', `/boards/${boardId}/members`, { email: ana.email })).status).toBe(403);
    expect((await beto.req('DELETE', `/boards/${boardId}/members/${ana.id}`)).status).toBe(403);
    expect((await beto.req('DELETE', `/boards/${boardId}`)).status).toBe(403);
  });

  it('no puede mover una tarjeta a la columna de OTRO tablero', async () => {
    const otherId = (await beto.req('POST', '/boards', { name: 'De Beto' })).data.id;
    const otherCol = (await beto.req('GET', `/boards/${otherId}`)).data.columns[0].id;
    const r = await beto.req('POST', `/cards/${cardId}/move`, { columnId: otherCol, index: 0 });
    expect(r.status).toBe(404);
  });
});

describe('salir y quitar', () => {
  it('el dueño no puede salirse de su propio tablero', async () => {
    expect((await ana.req('DELETE', `/boards/${boardId}/members/${ana.id}`)).status).toBe(400);
  });

  it('un miembro puede salirse y pierde el acceso', async () => {
    expect((await beto.req('DELETE', `/boards/${boardId}/members/${beto.id}`)).status).toBe(204);
    expect((await beto.req('GET', `/boards/${boardId}`)).status).toBe(404);
  });

  it('al eliminar el tablero se borra todo en cascada', async () => {
    expect((await ana.req('DELETE', `/boards/${boardId}`)).status).toBe(204);
    expect((await ana.req('GET', `/boards/${boardId}`)).status).toBe(404);
    expect((await ana.req('PATCH', `/cards/${cardId}`, { title: 'x' })).status).toBe(404);
  });
});

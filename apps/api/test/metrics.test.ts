import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, registerUser, resetDb, startServer } from './helpers';

// Servicio ML falso: guarda lo que recibe y responde algo fijo.
const received: { body: any; token: string | undefined }[] = [];
const fakeMl = Fastify();
fakeMl.post('/analyze', async (req) => {
  received.push({ body: req.body, token: req.headers['x-ml-token'] as string | undefined });
  return { insights: ['respuesta del servicio ML falso'] };
});

let server: Awaited<ReturnType<typeof startServer>>;
let ana: Awaited<ReturnType<typeof registerUser>>;
let beto: Awaited<ReturnType<typeof registerUser>>;
let boardId: string;
let cols: string[];

beforeAll(async () => {
  await resetDb();
  await fakeMl.listen({ port: 0, host: '127.0.0.1' });
  process.env.ML_URL = `http://127.0.0.1:${(fakeMl.server.address() as AddressInfo).port}`;
  process.env.ML_TOKEN = 'token-de-prueba';
  server = await startServer();
  ana = await registerUser(server.base, 'Ana');
  beto = await registerUser(server.base, 'Beto');
  boardId = (await ana.req('POST', '/boards', { name: 'Métricas' })).data.id;
  cols = (await ana.req('GET', `/boards/${boardId}`)).data.columns.map((c: { id: string }) => c.id);
});
afterAll(async () => {
  await server.app.close();
  await fakeMl.close();
});

describe('historial de eventos', () => {
  it('registra crear, cambiar de columna y eliminar (no los reordenamientos)', async () => {
    const a = (await ana.req('POST', '/cards', { columnId: cols[0], title: 'A' })).data.id;
    await ana.req('POST', '/cards', { columnId: cols[0], title: 'B' });
    await ana.req('POST', `/cards/${a}/move`, { columnId: cols[0], index: 1 }); // reordenar: sin evento
    await ana.req('POST', `/cards/${a}/move`, { columnId: cols[1], index: 0 }); // cambio de columna
    await ana.req('DELETE', `/cards/${a}`);

    const events = await prisma.cardEvent.findMany({ where: { cardId: a }, orderBy: { at: 'asc' } });
    expect(events.map((e) => [e.type, e.fromColumnId, e.toColumnId])).toEqual([
      ['created', null, cols[0]],
      ['moved', cols[0], cols[1]],
      ['deleted', cols[1], null],
    ]);
  });

  it('un movimiento rechazado no deja eventos', async () => {
    const before = await prisma.cardEvent.count();
    const b = (await ana.req('GET', `/boards/${boardId}`)).data.cards[0].id;
    expect((await beto.req('POST', `/cards/${b}/move`, { columnId: cols[2], index: 0 })).status).toBe(404);
    expect(await prisma.cardEvent.count()).toBe(before);
  });
});

describe('GET /boards/:id/metrics', () => {
  it('un no miembro recibe 404 y no se llama al servicio ML', async () => {
    received.length = 0;
    expect((await beto.req('GET', `/boards/${boardId}/metrics`)).status).toBe(404);
    expect(received).toHaveLength(0);
  });

  it('un miembro recibe la respuesta del servicio ML', async () => {
    received.length = 0;
    const r = await ana.req('GET', `/boards/${boardId}/metrics`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ insights: ['respuesta del servicio ML falso'] });

    const [{ body, token }] = received;
    expect(token).toBe('token-de-prueba');
    expect(body.columns.map((c: { id: string }) => c.id).sort()).toEqual([...cols].sort());
    expect(body.cards.map((c: { title: string }) => c.title)).toEqual(['B']);
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'created', 'moved', 'deleted']);
    expect(Date.parse(body.now)).not.toBeNaN();
  });

  it('solo envía los datos del tablero pedido', async () => {
    const other = (await beto.req('POST', '/boards', { name: 'De Beto' })).data.id;
    const otherCol = (await beto.req('GET', `/boards/${other}`)).data.columns[0].id;
    await beto.req('POST', '/cards', { columnId: otherCol, title: 'Privada de Beto' });

    received.length = 0;
    await ana.req('GET', `/boards/${boardId}/metrics`);
    expect(JSON.stringify(received[0].body)).not.toContain('Privada de Beto');
  });

  it('si el servicio ML no responde: 503 con mensaje amigable, sin detalles internos', async () => {
    process.env.ML_URL = 'http://127.0.0.1:1';
    const r = await ana.req('GET', `/boards/${boardId}/metrics`);
    expect(r.status).toBe(503);
    expect(r.data).toEqual({
      error: 'MlUnavailable',
      message: 'El servicio de análisis no está disponible en este momento',
    });
  });
});

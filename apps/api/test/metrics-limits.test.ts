import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser, resetDb, startServer } from './helpers';
import { fakeAnalysis } from './ml-fixture';

// S-05: /metrics no debe poder usarse para agotar la CPU del servicio ML.
let calls = 0;
let delayMs = 0;
const fakeMl = Fastify();
fakeMl.post('/analyze', async () => {
  calls++;
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  return fakeAnalysis([`cálculo ${calls}`]);
});

let server: Awaited<ReturnType<typeof startServer>>;
let ana: Awaited<ReturnType<typeof registerUser>>;
let beto: Awaited<ReturnType<typeof registerUser>>;

async function newBoard(user: typeof ana, name: string) {
  const id = (await user.req('POST', '/boards', { name })).data.id as string;
  const col = (await user.req('GET', `/boards/${id}`)).data.columns[0].id as string;
  return { id, col };
}

beforeAll(async () => {
  await resetDb();
  await fakeMl.listen({ port: 0, host: '127.0.0.1' });
  process.env.ML_URL = `http://127.0.0.1:${(fakeMl.server.address() as AddressInfo).port}`;
  server = await startServer({ metrics: { ttlMs: 60_000, computesPerUserPerMinute: 3 } });
  ana = await registerUser(server.base, 'Ana');
  beto = await registerUser(server.base, 'Beto');
});
afterAll(async () => {
  await server.app.close();
  await fakeMl.close();
});

describe('S-05: caché y límites de /metrics', () => {
  it('sin cambios en el tablero, pedir métricas otra vez no recalcula', async () => {
    const b = await newBoard(ana, 'Caché');
    calls = 0;
    for (let i = 0; i < 5; i++) {
      expect((await ana.req('GET', `/boards/${b.id}/metrics`)).status).toBe(200);
    }
    expect(calls).toBe(1);
  });

  it('un cambio en el tablero sí produce un análisis nuevo', async () => {
    const b = await newBoard(beto, 'Cambia');
    calls = 0;
    await beto.req('GET', `/boards/${b.id}/metrics`);
    await beto.req('POST', '/cards', { columnId: b.col, title: 'Nueva' });
    const r = await beto.req('GET', `/boards/${b.id}/metrics`);
    expect(calls).toBe(2);
    expect(r.data.insights).toEqual(['cálculo 2']);
  });

  it('100 peticiones simultáneas comparten un solo cálculo', async () => {
    const other = await registerUser(server.base, 'Carla');
    const b = await newBoard(other, 'Ráfaga');
    calls = 0;
    delayMs = 200;
    const statuses = await Promise.all(
      Array.from({ length: 100 }, () => other.req('GET', `/boards/${b.id}/metrics`).then((r) => r.status)),
    );
    delayMs = 0;
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(calls).toBe(1);
  });

  it('pasado el límite por minuto: devuelve el último análisis o 429, sin llamar al ML', async () => {
    const dani = await registerUser(server.base, 'Dani');
    const b = await newBoard(dani, 'Límite');
    calls = 0;
    for (let i = 0; i < 3; i++) {
      await dani.req('POST', '/cards', { columnId: b.col, title: `T${i}` });
      expect((await dani.req('GET', `/boards/${b.id}/metrics`)).status).toBe(200);
    }
    expect(calls).toBe(3);

    // 4.º cálculo en el mismo minuto: responde con el último guardado.
    await dani.req('POST', '/cards', { columnId: b.col, title: 'T3' });
    const stale = await dani.req('GET', `/boards/${b.id}/metrics`);
    expect(stale.status).toBe(200);
    expect(stale.data.insights).toEqual(['cálculo 3']);
    expect(calls).toBe(3);

    // Un tablero sin análisis guardado: 429 con Retry-After.
    const b2 = await newBoard(dani, 'Sin caché');
    const r = await dani.req('GET', `/boards/${b2.id}/metrics`);
    expect(r.status).toBe(429);
    expect(calls).toBe(3);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connected, registerUser, resetDb, socketFor, startServer } from './helpers';

// S-16: topes por usuario, por tablero y por conexión.
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  await resetDb();
  server = await startServer({
    limits: { boardsPerOwner: 2, cardsPerBoard: 3, writesPerMinute: 1000, socketEventsPer10s: 5 },
  });
});
afterAll(() => server.app.close());

describe('S-16: topes', () => {
  it('un usuario no puede crear tableros sin límite', async () => {
    const u = await registerUser(server.base, 'Tablerista');
    expect((await u.req('POST', '/boards', { name: 'Uno' })).status).toBe(201);
    expect((await u.req('POST', '/boards', { name: 'Dos' })).status).toBe(201);
    const third = await u.req('POST', '/boards', { name: 'Tres' });
    expect(third.status).toBe(403);
    expect(third.data.error).toBe('QuotaExceeded');
  });

  it('un tablero no acepta tarjetas sin límite', async () => {
    const u = await registerUser(server.base, 'Tarjetero');
    const b = (await u.req('POST', '/boards', { name: 'Lleno' })).data.id;
    const col = (await u.req('GET', `/boards/${b}`)).data.columns[0].id;
    for (let i = 0; i < 3; i++) {
      expect((await u.req('POST', '/cards', { columnId: col, title: `T${i}` })).status).toBe(201);
    }
    expect((await u.req('POST', '/cards', { columnId: col, title: 'una más' })).status).toBe(403);
  });

  it('las escrituras por minuto tienen tope', async () => {
    const limited = await startServer({ limits: { writesPerMinute: 3 } });
    try {
      const u = await registerUser(limited.base, 'Apurado');
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await u.req('POST', '/boards', { name: `B${i}` })).status);
      expect(statuses).toEqual([201, 201, 201, 429]);
      // Leer sigue permitido.
      expect((await u.req('GET', '/boards')).status).toBe(200);
    } finally {
      await limited.app.close();
    }
  });

  it('un id con formato inválido responde 404 sin llegar a la base', async () => {
    const u = await registerUser(server.base, 'Curioso');
    for (const path of ["/boards/1' OR '1'='1", '/boards/abc/metrics', '/cards/123/move']) {
      const method = path.endsWith('/move') ? 'POST' : 'GET';
      const r = await u.req(method, path, method === 'POST' ? { columnId: crypto.randomUUID(), index: 0 } : undefined);
      expect(r.status, path).toBe(404);
    }
  });

  it('un socket no puede inundar al servidor con eventos', async () => {
    const u = await registerUser(server.base, 'Ruidoso');
    const s = socketFor(server.base, u.cookie);
    try {
      expect(await connected(s)).toBe('ok');
      let answered = 0;
      for (let i = 0; i < 12; i++) s.emit('board:join', crypto.randomUUID(), () => answered++);
      await new Promise((r) => setTimeout(r, 800));
      expect(answered).toBe(5); // el resto se descartó
      expect(s.connected).toBe(true);
    } finally {
      s.close();
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_POSITION_LENGTH } from '@kanban/shared';
import { connected, joinBoard, prisma, registerUser, resetDb, socketFor, startServer, waitForEvent } from './helpers';

// S-20: las posiciones nunca deben dejar una columna inutilizable.
let server: Awaited<ReturnType<typeof startServer>>;
let ana: Awaited<ReturnType<typeof registerUser>>;

beforeAll(async () => {
  await resetDb();
  server = await startServer();
  ana = await registerUser(server.base, 'Ana');
});
afterAll(() => server.app.close());

async function boardWithCards(titles: string[]) {
  const id = (await ana.req('POST', '/boards', { name: 'Posiciones' })).data.id as string;
  const col = (await ana.req('GET', `/boards/${id}`)).data.columns[0].id as string;
  const cards: string[] = [];
  for (const title of titles) cards.push((await ana.req('POST', '/cards', { columnId: col, title })).data.id);
  return { id, col, cards };
}

const positions = async (col: string) =>
  (await prisma.card.findMany({ where: { columnId: col }, orderBy: { position: 'asc' } })).map((c) => c.position);

describe('S-20: posiciones', () => {
  it('dos tarjetas con la misma posición ya no producen un 500 al mover entre ellas', async () => {
    const b = await boardWithCards(['A', 'B', 'C']);
    // Simula el resultado de dos creaciones simultáneas: A y B quedan con la misma clave.
    const [a] = await prisma.card.findMany({ where: { id: b.cards[0] } });
    await prisma.card.update({ where: { id: b.cards[1] }, data: { position: a!.position } });

    const s = socketFor(server.base, ana.cookie);
    try {
      await connected(s);
      await joinBoard(s, b.id);
      const r = await ana.req('POST', `/cards/${b.cards[2]}/move`, { columnId: b.col, index: 1 });
      expect(r.status).toBe(200);
      await waitForEvent(s, 'board:reordered', (p) => p.boardId === b.id);
    } finally {
      s.close();
    }
    const ps = await positions(b.col);
    expect(new Set(ps).size).toBe(3); // todas distintas otra vez
  });

  it('una clave demasiado larga se corrige reordenando la columna', async () => {
    const b = await boardWithCards(['A', 'B', 'C']);
    await prisma.card.update({ where: { id: b.cards[1] }, data: { position: 'a0' + 'V'.repeat(80) } });
    const r = await ana.req('POST', `/cards/${b.cards[2]}/move`, { columnId: b.col, index: 1 });
    expect(r.status).toBe(200);
    for (const p of await positions(b.col)) expect(p.length).toBeLessThanOrEqual(MAX_POSITION_LENGTH);
  });

  it('20 tarjetas creadas a la vez quedan ordenables', async () => {
    const b = await boardWithCards([]);
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ana.req('POST', '/cards', { columnId: b.col, title: `P${i}` })),
    );
    expect(created.every((r) => r.status === 201)).toBe(true);
    // Mover al medio funciona aunque la carrera haya dejado claves repetidas.
    const r = await ana.req('POST', `/cards/${created[0]!.data.id}/move`, { columnId: b.col, index: 10 });
    expect(r.status).toBe(200);
  });
});

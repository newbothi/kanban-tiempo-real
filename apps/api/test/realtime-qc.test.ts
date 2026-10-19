/**
 * Fase 4 (QC): los casos de tiempo real y de permisos que faltaban.
 * Ningún test usa esperas fijas: se espera el evento, o se usa `roundTrip` como barrera.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  connected,
  joinBoard,
  registerUser,
  resetDb,
  roundTrip,
  socketFor,
  startServer,
  waitForEvent,
} from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let ana: Awaited<ReturnType<typeof registerUser>>;
let beto: Awaited<ReturnType<typeof registerUser>>;
let carla: Awaited<ReturnType<typeof registerUser>>;
let boardId: string;
let cols: string[];
const sockets: ReturnType<typeof socketFor>[] = [];
const open = async (cookie: string) => {
  const s = socketFor(server.base, cookie);
  sockets.push(s);
  expect(await connected(s)).toBe('ok');
  return s;
};

beforeAll(async () => {
  await resetDb();
  server = await startServer();
  ana = await registerUser(server.base, 'Ana');
  beto = await registerUser(server.base, 'Beto');
  carla = await registerUser(server.base, 'Carla');
  boardId = (await ana.req('POST', '/boards', { name: 'QC' })).data.id;
  cols = (await ana.req('GET', `/boards/${boardId}`)).data.columns.map((c: { id: string }) => c.id);
  await addMember(ana, boardId, beto);
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await server.app.close();
});

describe('un miembro trabaja con las tarjetas de otros', () => {
  it('puede renombrar y borrar una tarjeta que creó el dueño, y los demás lo ven en vivo', async () => {
    const sAna = await open(ana.cookie);
    const sBeto = await open(beto.cookie);
    await joinBoard(sAna, boardId);
    await joinBoard(sBeto, boardId);
    const card = (await ana.req('POST', '/cards', { columnId: cols[0], title: 'De Ana' })).data;

    const renamed = await beto.req('PATCH', `/cards/${card.id}`, { title: '  Renombrada por Beto  ' }, {
      'x-socket-id': sBeto.id!,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.data.title).toBe('Renombrada por Beto'); // se recortan los espacios
    expect(await waitForEvent(sAna, 'card:updated', (c) => c.id === card.id)).toEqual(renamed.data);

    const del = await beto.req('DELETE', `/cards/${card.id}`, undefined, { 'x-socket-id': sBeto.id! });
    expect(del.status).toBe(204);
    expect(await waitForEvent(sAna, 'card:deleted', (p) => p.id === card.id)).toEqual({ id: card.id });
    // Quien borró no recibe su propio evento.
    await roundTrip(sBeto);
    expect(sBeto.events.some(([e, p]) => e === 'card:deleted' && p.id === card.id)).toBe(false);
    expect((await ana.req('GET', `/boards/${boardId}`)).data.cards.some((c: { id: string }) => c.id === card.id)).toBe(
      false,
    );
  });

  it('una tarjeta borrada ya no se puede mover ni renombrar (404)', async () => {
    const card = (await ana.req('POST', '/cards', { columnId: cols[0], title: 'Efímera' })).data;
    await beto.req('DELETE', `/cards/${card.id}`);
    expect((await beto.req('PATCH', `/cards/${card.id}`, { title: 'x' })).status).toBe(404);
    expect((await ana.req('POST', `/cards/${card.id}/move`, { columnId: cols[1], index: 0 })).status).toBe(404);
    expect((await ana.req('DELETE', `/cards/${card.id}`)).status).toBe(404);
  });
});

describe('entradas mal formadas o enormes', () => {
  it('rechaza títulos vacíos, solo espacios o de más de 500 caracteres', async () => {
    for (const title of ['', '   ', 'x'.repeat(501)]) {
      const r = await ana.req('POST', '/cards', { columnId: cols[0], title });
      expect(r.status, JSON.stringify(title.slice(0, 10))).toBe(400);
    }
    expect((await ana.req('POST', '/cards', { columnId: cols[0], title: 'x'.repeat(500) })).status).toBe(201);
  });

  it('rechaza tipos equivocados y campos faltantes sin un 500', async () => {
    const bad: unknown[] = [
      { columnId: cols[0] },
      { columnId: cols[0], title: 123 },
      { columnId: 'no-es-uuid', title: 'x' },
      { columnId: cols[0], title: ['x'] },
      null,
      'texto',
    ];
    for (const body of bad) {
      const r = await ana.req('POST', '/cards', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('mover exige un índice entero no negativo', async () => {
    const card = (await ana.req('POST', '/cards', { columnId: cols[0], title: 'Mover' })).data;
    for (const index of [-1, 1.5, '0', null]) {
      const r = await ana.req('POST', `/cards/${card.id}/move`, { columnId: cols[1], index });
      expect(r.status, String(index)).toBe(400);
    }
    // Un índice más allá del final deja la tarjeta al final (no falla).
    const r = await ana.req('POST', `/cards/${card.id}/move`, { columnId: cols[1], index: 9999 });
    expect(r.status).toBe(200);
  });

  it('un JSON roto responde 400 y un cuerpo de más de 1 MB, 413', async () => {
    const res = await fetch(`${server.base}/api/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ana.cookie },
      body: '{"columnId": ',
    });
    expect(res.status).toBe(400);

    const big = await fetch(`${server.base}/api/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ana.cookie },
      body: JSON.stringify({ columnId: cols[0], title: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(big.status).toBe(413);
  });

  it('nombres de tablero: vacío o de más de 200 caracteres no; el resto se guarda recortado', async () => {
    expect((await ana.req('POST', '/boards', { name: ' ' })).status).toBe(400);
    expect((await ana.req('POST', '/boards', { name: 'x'.repeat(201) })).status).toBe(400);
    const ok = await ana.req('POST', '/boards', { name: '  Con espacios  ' });
    expect(ok.status).toBe(201);
    expect(ok.data.name).toBe('Con espacios');
  });

  it('los errores de validación no filtran detalles internos', async () => {
    const r = await ana.req('POST', '/cards', { columnId: cols[0], title: 123 });
    expect(JSON.stringify(r.data)).not.toMatch(/prisma|stack|at \w+ \(|node_modules/i);
  });
});

describe('miembros y presencia en vivo', () => {
  it('el dueño ve en vivo cuando alguien acepta una invitación (board:membersChanged)', async () => {
    const sAna = await open(ana.cookie);
    await joinBoard(sAna, boardId);
    sAna.events.length = 0;
    await ana.req('POST', `/boards/${boardId}/members`, { email: carla.email });
    // Invitar cambia las pendientes del dueño…
    await waitForEvent(sAna, 'board:membersChanged', (p) => p.boardId === boardId);
    sAna.events.length = 0;
    const inv = (await carla.req('GET', '/invites')).data[0];
    await carla.req('POST', `/invites/${inv.id}/accept`);
    // …y aceptar cambia la lista de miembros.
    await waitForEvent(sAna, 'board:membersChanged', (p) => p.boardId === boardId);
  });

  it('la presencia baja cuando alguien cierra la pestaña', async () => {
    // Tablero propio para el test: así la cuenta no depende de los sockets de otros tests.
    const id = (await ana.req('POST', '/boards', { name: 'Presencia' })).data.id;
    await addMember(ana, id, carla);
    const sAna = await open(ana.cookie);
    await joinBoard(sAna, id);
    const sCarla = await open(carla.cookie);
    await joinBoard(sCarla, id);
    await waitForEvent(sAna, 'board:presence', (p) => p.boardId === id && p.count === 2);
    sAna.events.length = 0;
    sCarla.close();
    await waitForEvent(sAna, 'board:presence', (p) => p.boardId === id && p.count === 1);
  });

  it('al salir del tablero (board:leave) deja de recibir sus eventos', async () => {
    const sBeto = await open(beto.cookie);
    await joinBoard(sBeto, boardId);
    sBeto.emit('board:leave', boardId);
    await roundTrip(sBeto);
    sBeto.events.length = 0;
    await ana.req('POST', '/cards', { columnId: cols[0], title: 'Sin Beto' });
    await roundTrip(sBeto);
    expect(sBeto.events.some(([e]) => e.startsWith('card:'))).toBe(false);
  });
});

describe('reconexión', () => {
  it('tras perder la conexión, vuelve a entrar, recibe lo nuevo y lo perdido está en GET', async () => {
    const sAna = await open(ana.cookie);
    await joinBoard(sAna, boardId);
    const sBeto = await open(beto.cookie);
    await joinBoard(sBeto, boardId);

    sBeto.disconnect();
    const missed = (await ana.req('POST', '/cards', { columnId: cols[0], title: 'Mientras no estaba' })).data;

    sBeto.connect();
    expect(await connected(sBeto)).toBe('ok');
    // Al reconectar el socket es otro: no conserva las rooms, hay que volver a entrar.
    expect(await joinBoard(sBeto, boardId)).toEqual({ ok: true });
    const board = (await beto.req('GET', `/boards/${boardId}`)).data;
    expect(board.cards.some((c: { id: string }) => c.id === missed.id)).toBe(true);

    const next = (await ana.req('POST', '/cards', { columnId: cols[0], title: 'Ya de vuelta' }, {
      'x-socket-id': sAna.id!,
    })).data;
    expect(await waitForEvent(sBeto, 'card:created', (c) => c.id === next.id)).toEqual(next);
  });
});

describe('concurrencia', () => {
  it('20 movimientos simultáneos de varias personas dejan un orden consistente', async () => {
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? ana : beto).req('POST', '/cards', { columnId: cols[0], title: `Carrera ${i}` }),
      ),
    );
    expect(created.map((r) => r.status)).toEqual(Array(20).fill(201));
    const ids: string[] = created.map((r) => r.data.id);

    // Todos a la vez: la mitad a "En curso", la otra mitad reordenándose dentro de "Por hacer".
    const moves = await Promise.all(
      ids.map((id, i) =>
        (i % 2 ? ana : beto).req('POST', `/cards/${id}/move`, {
          columnId: i % 2 ? cols[1] : cols[0],
          index: i % 5,
        }),
      ),
    );
    const failures = moves.filter((r) => r.status !== 200).map((r) => r.data?.debug ?? r.status);
    expect(failures, `errores: ${[...new Set(failures)].join(' | ')}`).toEqual([]);

    const board = (await ana.req('GET', `/boards/${boardId}`)).data;
    for (const col of [cols[0], cols[1]]) {
      const positions = board.cards
        .filter((c: { columnId: string }) => c.columnId === col)
        .map((c: { position: string }) => c.position);
      // Sin claves repetidas: el orden de la columna está bien definido para todos.
      expect(new Set(positions).size).toBe(positions.length);
    }
    for (const [i, id] of ids.entries()) {
      expect(board.cards.find((c: { id: string }) => c.id === id)?.columnId).toBe(i % 2 ? cols[1] : cols[0]);
    }
  });
});

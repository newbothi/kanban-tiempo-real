/**
 * Genera un tablero con ~6 meses de historia SIMULADA para que el análisis (servicio ML)
 * tenga datos con los que trabajar. Es determinista: misma semilla → mismos datos.
 *
 * Modelo de la simulación (lo que el ML debería "descubrir"):
 * - Llegan tarjetas a un ritmo que crece levemente con el tiempo (el equipo mejora).
 * - Cada tipo de tarea tiene una duración base distinta (bug < docs < refactor < feature).
 * - Cuantas más tarjetas hay en progreso al empezar una, más tarda (ley de Little / multitarea).
 * - Algunas tarjetas se quedan "pegadas" mucho más de lo normal.
 *
 * Uso:  npm run db:simulate                 (dueño: demo@kanban.cl)
 *       npm run db:simulate -- otro@correo.cl
 */
import { generateNKeysBetween } from 'fractional-indexing';
import { prisma } from '../src/db';

const BOARD_NAME = 'Proyecto simulado · datos sintéticos';
const COLUMNS = ['Por hacer', 'En progreso', 'En revisión', 'Hecho'];
const WEEKS = 26;
const PLANNED = 30; // tarjetas del próximo sprint, todavía sin empezar
const DAY = 24 * 60 * 60 * 1000;

// ---------- Aleatoriedad reproducible ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261007);
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const lognormal = (median: number, sigma: number) => median * Math.exp(sigma * normal());
const poisson = (lambda: number) => {
  let k = 0;
  let p = 1;
  const l = Math.exp(-lambda);
  do {
    k++;
    p *= rand();
  } while (p > l);
  return k - 1;
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

// ---------- Tipos de tarea ----------
const KINDS = [
  { prefix: 'Bug', weight: 0.35, backlogDays: 1.5, workDays: 1.2, reviewDays: 0.6,
    topics: ['login falla con correos en mayúsculas', 'el contador de columnas no se actualiza', 'error 500 al mover tarjetas', 'la sesión expira antes de tiempo', 'tarjetas duplicadas al reconectar', 'scroll roto en móviles', 'fecha mal formateada en el panel'] },
  { prefix: 'Feature', weight: 0.35, backlogDays: 4, workDays: 3.5, reviewDays: 1.2,
    topics: ['etiquetas de colores en tarjetas', 'filtros por responsable', 'exportar tablero a CSV', 'modo oscuro', 'comentarios en tarjetas', 'notificaciones por correo', 'búsqueda de tarjetas', 'adjuntar archivos'] },
  { prefix: 'Docs', weight: 0.15, backlogDays: 3, workDays: 1, reviewDays: 0.5,
    topics: ['guía de instalación', 'documentar la API', 'diagrama de arquitectura', 'actualizar el README', 'manual de despliegue'] },
  { prefix: 'Refactor', weight: 0.15, backlogDays: 5, workDays: 2.5, reviewDays: 1,
    topics: ['separar capa de acceso a datos', 'tipar eventos del socket', 'extraer validaciones', 'simplificar el reducer', 'limpiar estilos duplicados'] },
] as const;

function pickKind() {
  let r = rand();
  for (const k of KINDS) {
    if ((r -= k.weight) <= 0) return k;
  }
  return KINDS[0];
}

interface SimCard {
  title: string;
  created: Date;
  /** instantes en que ENTRA a cada columna (índice = columna); undefined = aún no llega */
  enter: (Date | undefined)[];
}

async function main() {
  const email = (process.argv[2] ?? 'demo@kanban.cl').toLowerCase();
  const owner = await prisma.user.findUnique({ where: { email } });
  if (!owner) throw new Error(`No existe el usuario ${email}. Corre primero npm run db:seed.`);

  // Si ya existe un tablero simulado de este usuario, se reemplaza.
  const old = await prisma.board.findMany({
    where: { name: BOARD_NAME, members: { some: { userId: owner.id, role: 'owner' } } },
    select: { id: true },
  });
  for (const b of old) await prisma.board.delete({ where: { id: b.id } });

  const now = new Date();
  const start = new Date(now.getTime() - WEEKS * 7 * DAY);
  const cards: SimCard[] = [];
  /** intervalos [inicio, fin) en que cada tarjeta estuvo "en progreso" o "en revisión" */
  const busy: [number, number][] = [];
  const wipAt = (t: number) => busy.filter(([a, b]) => a <= t && t < b).length;

  for (let week = 0; week < WEEKS; week++) {
    // El ritmo de llegada sube de ~4 a ~7 tarjetas por semana a lo largo de los 6 meses.
    const arrivals = poisson(4 + (3 * week) / WEEKS);
    for (let i = 0; i < arrivals; i++) {
      const kind = pickKind();
      const created = new Date(start.getTime() + (week * 7 + rand() * 7) * DAY);
      const startWork = created.getTime() + lognormal(kind.backlogDays, 0.6) * DAY;

      // Multitarea: cada tarjeta ya en curso alarga el trabajo un 12%.
      const wip = wipAt(startWork);
      let work = lognormal(kind.workDays, 0.45) * (1 + 0.12 * wip);
      if (rand() < 0.06) work *= 4; // algunas se "pegan" (bloqueos, dependencias)
      const review = lognormal(kind.reviewDays, 0.5);

      const toReview = startWork + work * DAY;
      const toDone = toReview + review * DAY;
      busy.push([startWork, toDone]);

      const enter = [created, new Date(startWork), new Date(toReview), new Date(toDone)].map((d) =>
        d.getTime() <= now.getTime() ? d : undefined,
      );
      cards.push({ title: `${kind.prefix}: ${pick(kind.topics)}`, created, enter });
    }
  }

  // Planificación del próximo sprint: tarjetas recién creadas que aún esperan en "Por hacer".
  // Así el pronóstico Monte Carlo tiene un backlog realista que proyectar.
  for (let i = 0; i < PLANNED; i++) {
    const kind = pickKind();
    const created = new Date(now.getTime() - rand() * 10 * DAY);
    cards.push({ title: `${kind.prefix}: ${pick(kind.topics)}`, created, enter: [created] });
  }

  // Tablero + columnas
  const colKeys = generateNKeysBetween(null, null, COLUMNS.length);
  const board = await prisma.board.create({
    data: {
      name: BOARD_NAME,
      members: { create: { userId: owner.id, role: 'owner' } },
      columns: { create: COLUMNS.map((title, i) => ({ title, position: colKeys[i] })) },
    },
    include: { columns: { orderBy: { position: 'asc' } } },
  });
  const columnIds = board.columns.map((c) => c.id);

  // Columna actual de cada tarjeta = la última a la que alcanzó a entrar.
  const current = cards.map((c) => c.enter.reduce((acc, d, i) => (d ? i : acc), 0));

  // Posiciones por columna (orden de llegada)
  const positions = new Map<number, string[]>();
  for (let col = 0; col < COLUMNS.length; col++) {
    const n = current.filter((c) => c === col).length;
    positions.set(col, n ? generateNKeysBetween(null, null, n) : []);
  }
  const used = new Map<number, number>();

  const cardRows = cards.map((c, i) => {
    const col = current[i];
    const k = used.get(col) ?? 0;
    used.set(col, k + 1);
    return {
      id: crypto.randomUUID(),
      columnId: columnIds[col],
      title: c.title,
      position: positions.get(col)![k],
      createdAt: c.created,
    };
  });

  const eventRows = cards.flatMap((c, i) => {
    const cardId = cardRows[i].id;
    const evs = [{ boardId: board.id, cardId, type: 'created', toColumnId: columnIds[0], at: c.created }];
    for (let col = 1; col < COLUMNS.length; col++) {
      const at = c.enter[col];
      if (!at) break;
      evs.push({
        boardId: board.id,
        cardId,
        type: 'moved',
        fromColumnId: columnIds[col - 1],
        toColumnId: columnIds[col],
        at,
      } as (typeof evs)[number]);
    }
    return evs;
  });

  // En lotes (SQL Server limita la cantidad de parámetros por consulta)
  for (let i = 0; i < cardRows.length; i += 200) {
    await prisma.card.createMany({ data: cardRows.slice(i, i + 200) });
  }
  for (let i = 0; i < eventRows.length; i += 200) {
    await prisma.cardEvent.createMany({ data: eventRows.slice(i, i + 200) });
  }

  const done = current.filter((c) => c === COLUMNS.length - 1).length;
  console.log(`Tablero "${BOARD_NAME}" creado para ${email}`);
  console.log(`  ${cards.length} tarjetas (${done} terminadas) y ${eventRows.length} eventos en ${WEEKS} semanas`);
}

await main();
await prisma.$disconnect();

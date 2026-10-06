import bcrypt from 'bcryptjs';
import { generateNKeysBetween } from 'fractional-indexing';
import { prisma } from '../src/db';

// Usuario de demostración para desarrollo.
const DEMO = { email: 'demo@kanban.cl', name: 'Usuario Demo', password: 'demo1234' };

let demo = await prisma.user.findUnique({ where: { email: DEMO.email } });
if (!demo) {
  demo = await prisma.user.create({
    data: {
      email: DEMO.email,
      name: DEMO.name,
      passwordHash: await bcrypt.hash(DEMO.password, 12),
    },
  });
  console.log(`Usuario demo creado: ${DEMO.email} / ${DEMO.password}`);
}

// Tableros creados antes de la Fase 4 no tienen dueño: se los asignamos al demo.
const orphans = await prisma.board.findMany({
  where: { members: { none: {} } },
  select: { id: true, name: true },
});
for (const b of orphans) {
  await prisma.boardMember.create({ data: { boardId: b.id, userId: demo.id, role: 'owner' } });
  console.log(`Tablero "${b.name}" asignado a ${DEMO.email}`);
}

// Si el demo no tiene ningún tablero, le creamos uno de ejemplo.
const demoBoards = await prisma.boardMember.count({ where: { userId: demo.id } });
if (demoBoards === 0) {
  const colKeys = generateNKeysBetween(null, null, 3);
  const seed: Record<string, string[]> = {
    'Por hacer': ['Diseñar pantalla de login', 'Escribir tests'],
    'En progreso': ['API de usuarios'],
    Hecho: ['Crear base de datos', 'Configurar repositorio'],
  };
  const board = await prisma.board.create({
    data: {
      name: 'Mi primer tablero',
      members: { create: { userId: demo.id, role: 'owner' } },
      columns: {
        create: Object.entries(seed).map(([title, cards], i) => {
          const cardKeys = generateNKeysBetween(null, null, cards.length);
          return {
            title,
            position: colKeys[i],
            cards: { create: cards.map((t, j) => ({ title: t, position: cardKeys[j] })) },
          };
        }),
      },
    },
  });
  console.log(`Tablero de ejemplo creado: ${board.id}`);
}

console.log('Seed listo.');
await prisma.$disconnect();

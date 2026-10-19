import bcrypt from 'bcryptjs';
import { prisma } from '../src/db';
import { createStarterBoard } from '../src/demo/demo';
import { assertSafeTarget } from './guard';

// Usuario de demostración para desarrollo. En producción el seed se niega a correr (S-18).
assertSafeTarget('db:seed');
const DEMO = { email: 'demo@kanban.cl', name: 'Usuario Demo', password: 'demo1234' };

let demo = await prisma.user.findUnique({ where: { email: DEMO.email } });
if (!demo) {
  demo = await prisma.user.create({
    data: {
      email: DEMO.email,
      name: DEMO.name,
      passwordHash: await bcrypt.hash(DEMO.password, 12),
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`Usuario demo creado: ${DEMO.email}`);
}

// Si el demo no tiene ningún tablero, le creamos uno de ejemplo.
const demoBoards = await prisma.boardMember.count({ where: { userId: demo.id } });
if (demoBoards === 0) {
  const board = await createStarterBoard(demo.id);
  console.log(`Tablero de ejemplo creado: ${board.id}`);
}

console.log('Seed listo.');
await prisma.$disconnect();

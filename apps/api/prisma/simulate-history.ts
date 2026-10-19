/**
 * Crea el tablero con ~6 meses de historia simulada (ver src/demo/simulated-board.ts).
 *
 * Uso:  npm run db:simulate                 (dueño: demo@kanban.cl)
 *       npm run db:simulate -- otro@correo.cl
 */
import { prisma } from '../src/db';
import { SIMULATED_BOARD_NAME, createSimulatedBoard } from '../src/demo/simulated-board';
import { assertSafeTarget } from './guard';

assertSafeTarget('db:simulate');
const email = (process.argv[2] ?? 'demo@kanban.cl').toLowerCase();
const owner = await prisma.user.findUnique({ where: { email } });
if (!owner) throw new Error(`No existe el usuario ${email}. Corre primero npm run db:seed.`);

const r = await createSimulatedBoard(owner.id);
console.log(`Tablero "${SIMULATED_BOARD_NAME}" creado para ${email}`);
console.log(`  ${r.cards} tarjetas (${r.done} terminadas) y ${r.events} eventos en ${r.weeks} semanas`);
await prisma.$disconnect();

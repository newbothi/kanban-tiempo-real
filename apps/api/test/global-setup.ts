import { execSync } from 'node:child_process';
import { config } from 'dotenv';

/** Antes de todos los tests: aplica las migraciones a la base de prueba (la crea si no existe). */
export default function setup() {
  config({ path: '.env.test', quiet: true });
  if (!/test/i.test(process.env.DATABASE_URL ?? '')) return; // setup-env.ts mostrará el error
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}

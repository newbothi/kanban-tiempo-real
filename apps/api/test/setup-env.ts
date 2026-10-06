import { config } from 'dotenv';

// Variables de .env.test (en CI vienen del workflow y no se sobrescriben).
config({ path: '.env.test', quiet: true });

const url = process.env.DATABASE_URL ?? '';
if (!/test/i.test(url)) {
  throw new Error(
    'DATABASE_URL de los tests debe apuntar a una base cuyo nombre contenga "test" ' +
      '(los tests BORRAN todos los datos). Revisa apps/api/.env.test',
  );
}

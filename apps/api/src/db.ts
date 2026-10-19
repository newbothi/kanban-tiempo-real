import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient } from './generated/prisma/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL (revisa apps/api/.env)');

// Prisma 7 se conecta a SQL Server mediante un "driver adapter" (usa el paquete mssql/tedious).
export const prisma = new PrismaClient({ adapter: new PrismaMssql(url) });

/** ¿El error es un conflicto de concurrencia que conviene reintentar? */
export function isConflict(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    e?.code === 'P2034' || // deadlock o conflicto de escritura (SQL Server 1205)
    e?.code === 'P2028' || // la transacción no consiguió conexión a tiempo
    /deadlock|1205|Unable to start a transaction/i.test(e?.message ?? '')
  );
}

/**
 * Reintenta una operación si SQL Server la eligió como víctima de un deadlock o no pudo
 * empezar la transacción. Es lo que SQL Server recomienda: la operación no hizo nada y se
 * puede repetir tal cual. Si sigue fallando, el manejador de errores responde 503.
 */
export async function retryOnConflict<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (!isConflict(err) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}

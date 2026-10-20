import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient } from './generated/prisma/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL (revisa apps/api/.env)');

/** Lo que acepta el adapter: una cadena de conexión o la configuración de mssql. */
type ConnectionConfig = ConstructorParameters<typeof PrismaMssql>[0];

const PASSWORDLESS = new Set(['activedirectorydefault', 'activedirectorymanagedidentity']);

/**
 * Configuración de conexión a partir de DATABASE_URL (formato de Prisma:
 * `sqlserver://host:puerto;database=x;clave=valor;...`).
 *
 * S-04: en Azure la app entra SIN contraseña, con su identidad administrada de Entra ID:
 *   sqlserver://servidor.database.windows.net:1433;database=kanban;authentication=ActiveDirectoryDefault
 * Con usuario y contraseña (desarrollo, tests, migraciones) se usa la cadena tal cual.
 */
export function connectionConfig(databaseUrl: string): ConnectionConfig {
  const [hostPart = '', ...pairs] = databaseUrl.replace(/^sqlserver:\/\//i, '').split(';');
  const params = new Map(
    pairs
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()] as const;
      }),
  );
  const auth = (params.get('authentication') ?? '').toLowerCase();
  if (!PASSWORDLESS.has(auth)) return databaseUrl;

  const [server = '', port] = hostPart.split(':');
  const database = params.get('database') ?? params.get('initial catalog');
  if (!server || !database) throw new Error('DATABASE_URL: faltan el servidor o la base');
  return {
    server,
    port: port ? Number(port) : 1433,
    database,
    // DefaultAzureCredential: en App Service usa la identidad administrada; en una máquina
    // con `az login`, la sesión de Azure CLI. Un clientId opcional elige una identidad asignada.
    authentication: {
      type: 'azure-active-directory-default',
      options: params.get('clientid') ? { clientId: params.get('clientid') } : {},
    },
    options: { encrypt: true, trustServerCertificate: false },
  } as ConnectionConfig;
}

// Prisma 7 se conecta a SQL Server mediante un "driver adapter" (usa el paquete mssql/tedious).
export const prisma = new PrismaClient({ adapter: new PrismaMssql(connectionConfig(url)) });

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

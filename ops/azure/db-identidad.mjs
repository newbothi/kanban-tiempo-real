#!/usr/bin/env node
/**
 * S-04: crea (o confirma) el usuario de la base para la identidad administrada de la app,
 * con permisos mínimos: leer y escribir datos (db_datareader + db_datawriter). Sin DDL:
 * las migraciones las sigue haciendo el administrador, desde Cloud Shell.
 *
 * También activa READ_COMMITTED_SNAPSHOT si estuviera apagado (Azure SQL lo trae activado),
 * que es el modo con el que se prueba en el CI.
 *
 * Se conecta con TU sesión de Azure CLI (tienes que ser el admin de Entra del servidor).
 * Uso, desde la raíz del repo y con una regla temporal en el firewall:
 *   node ops/azure/db-identidad.mjs --servidor kanban-newbothi-us.database.windows.net \
 *     --base kanban --app kanban-newbothi --object-id <principalId de la identidad>
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import sql from 'mssql';

const { values: a } = parseArgs({
  options: {
    servidor: { type: 'string' },
    base: { type: 'string', default: 'kanban' },
    app: { type: 'string' },
    'object-id': { type: 'string' },
  },
});

// Los nombres van dentro de SQL dinámico (CREATE USER no acepta parámetros): se validan antes.
const check = (ok, msg) => {
  if (!ok) {
    console.error(`✗ ${msg}`);
    process.exit(2);
  }
};
check(/^[a-z0-9.-]+\.database\.windows\.net$/i.test(a.servidor ?? ''), '--servidor debe ser <nombre>.database.windows.net');
check(/^[A-Za-z0-9_-]{1,128}$/.test(a.base), '--base inválida');
check(/^[A-Za-z0-9-]{1,60}$/.test(a.app ?? ''), '--app debe ser el nombre de la web app');
check(/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(a['object-id'] ?? ''), '--object-id debe ser el principalId (un GUID)');

const token = execFileSync(
  'az',
  ['account', 'get-access-token', '--resource', 'https://database.windows.net/', '--query', 'accessToken', '-o', 'tsv'],
  { encoding: 'utf8' },
).trim();

const pool = await sql.connect({
  server: a.servidor,
  database: a.base,
  options: { encrypt: true },
  authentication: { type: 'azure-active-directory-access-token', options: { token } },
});

try {
  const name = a.app;
  const exists = await pool.request().input('n', sql.NVarChar, name).query('SELECT 1 AS x FROM sys.database_principals WHERE name = @n');
  if (exists.recordset.length) {
    console.log(`✓ el usuario [${name}] ya existía`);
  } else {
    // WITH OBJECT_ID: no hace falta que el servidor pueda leer el directorio de Entra.
    await pool.request().batch(`CREATE USER [${name}] FROM EXTERNAL PROVIDER WITH OBJECT_ID = '${a['object-id']}'`);
    console.log(`✓ usuario [${name}] creado para la identidad administrada`);
  }
  for (const role of ['db_datareader', 'db_datawriter']) {
    await pool.request().batch(`IF IS_ROLEMEMBER('${role}', '${name}') = 0 ALTER ROLE [${role}] ADD MEMBER [${name}]`);
  }
  const roles = await pool
    .request()
    .input('n', sql.NVarChar, name)
    .query(`SELECT r.name AS rol FROM sys.database_role_members m
            JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
            JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
            WHERE u.name = @n ORDER BY r.name`);
  console.log(`✓ roles de [${name}]: ${roles.recordset.map((r) => r.rol).join(', ')}`);

  const rcsi = await pool.request().query('SELECT is_read_committed_snapshot_on AS on_ FROM sys.databases WHERE name = DB_NAME()');
  if (rcsi.recordset[0]?.on_) {
    console.log('✓ READ_COMMITTED_SNAPSHOT ya estaba activado');
  } else {
    await pool.request().batch('ALTER DATABASE CURRENT SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE');
    console.log('✓ READ_COMMITTED_SNAPSHOT activado');
  }
} finally {
  await pool.close();
}

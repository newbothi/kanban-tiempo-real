import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'sqlserver://localhost:1;database=sin_bd_test';
const { connectionConfig } = await import('../../src/db');

describe('S-04: conexión sin contraseña con la identidad administrada', () => {
  it('con authentication=ActiveDirectoryDefault arma una conexión de Entra ID, sin usuario ni contraseña', () => {
    const cfg = connectionConfig(
      'sqlserver://kanban.database.windows.net:1433;database=kanban;encrypt=true;authentication=ActiveDirectoryDefault',
    );
    expect(cfg).toEqual({
      server: 'kanban.database.windows.net',
      port: 1433,
      database: 'kanban',
      authentication: { type: 'azure-active-directory-default', options: {} },
      options: { encrypt: true, trustServerCertificate: false },
    });
    expect(JSON.stringify(cfg)).not.toMatch(/password|user=/i);
  });

  it('acepta ActiveDirectoryManagedIdentity, mayúsculas distintas y un clientId de identidad asignada', () => {
    const cfg = connectionConfig(
      'sqlserver://srv.database.windows.net;Database=kanban;Authentication=activedirectorymanagedidentity;clientId=abc',
    ) as { port: number; authentication: { options: { clientId?: string } } };
    expect(cfg.port).toBe(1433);
    expect(cfg.authentication.options.clientId).toBe('abc');
  });

  it('con usuario y contraseña (desarrollo, tests y migraciones) deja la cadena tal cual', () => {
    const url = 'sqlserver://localhost:1433;database=kanban;user=sa;password=x;encrypt=true;trustServerCertificate=true';
    expect(connectionConfig(url)).toBe(url);
  });

  it('una cadena sin servidor o sin base falla al arrancar, no en la primera consulta', () => {
    expect(() => connectionConfig('sqlserver://srv;authentication=ActiveDirectoryDefault')).toThrow(/servidor o la base/);
  });
});

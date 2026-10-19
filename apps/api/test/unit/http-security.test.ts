import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Estas pruebas no tocan la base de datos (Prisma se conecta recién en la primera consulta).
process.env.DATABASE_URL ??= 'sqlserver://localhost:1;database=sin_bd_test';
process.env.JWT_SECRET ??= 'secreto-solo-para-tests-unitarios-xxxxxxxxxx';
const { buildApp } = await import('../../src/app');

const webDist = mkdtempSync(join(tmpdir(), 'kanban-web-'));
writeFileSync(join(webDist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(webDist, '.env'), 'JWT_SECRET=no-deberias-ver-esto');

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ logger: false, webDist });
});
afterAll(() => app.close());

describe('S-11: cabeceras de seguridad', () => {
  it('la web y la API responden con CSP, nosniff y referrer-policy', async () => {
    for (const url of ['/', '/api/auth/me']) {
      const r = await app.inject({ method: 'GET', url });
      const csp = String(r.headers['content-security-policy']);
      expect(csp, url).toContain("default-src 'self'");
      expect(csp, url).toContain("frame-ancestors 'none'");
      expect(csp, url).toContain("script-src 'self'");
      expect(r.headers['x-content-type-options'], url).toBe('nosniff');
      expect(r.headers['referrer-policy'], url).toBe('no-referrer');
    }
  });
});

describe('S-16: ids con formato inválido', () => {
  it('responden 404 antes de llegar a la base', async () => {
    const r = await app.inject({ method: 'GET', url: "/api/boards/1'%20OR%20'1'='1" });
    expect(r.statusCode).toBe(404);
  });
});

describe('archivos estáticos', () => {
  it('nunca sirve archivos ocultos como .env', async () => {
    const r = await app.inject({ method: 'GET', url: '/.env' });
    expect(r.body).not.toContain('no-deberias-ver-esto');
  });
});

describe('S-15: CORS', () => {
  it('no autoriza orígenes ajenos', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/api/boards',
      headers: { origin: 'https://sitio-malicioso.example', 'access-control-request-method': 'POST' },
    });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});

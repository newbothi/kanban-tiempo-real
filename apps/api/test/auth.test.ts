import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpClient, prisma, resetDb, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  await resetDb();
  server = await startServer();
});
afterAll(async () => {
  await server.app.close();
});

describe('registro', () => {
  it('crea la cuenta, normaliza el correo y deja la sesión iniciada', async () => {
    const c = httpClient(server.base);
    const r = await c.req('POST', '/auth/register', {
      email: '  Ana@Correo.CL ',
      name: 'Ana',
      password: 'secreta123',
    });
    expect(r.status).toBe(201);
    expect(r.data).toEqual({ id: expect.any(String), email: 'ana@correo.cl', name: 'Ana' });
    expect((await c.req('GET', '/auth/me')).data.name).toBe('Ana');
  });

  it('la cookie es httpOnly y SameSite=Lax', async () => {
    const r = await httpClient(server.base).req('POST', '/auth/register', {
      email: 'cookie@correo.cl',
      name: 'Cookie',
      password: 'secreta123',
    });
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).toMatch(/SameSite=Lax/i);
  });

  it('guarda la contraseña como hash bcrypt, nunca en texto plano', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@correo.cl' } });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain('secreta123');
  });

  it('rechaza correos duplicados (sin importar mayúsculas)', async () => {
    const r = await httpClient(server.base).req('POST', '/auth/register', {
      email: 'ANA@correo.cl',
      name: 'Otra',
      password: 'otraclave1',
    });
    expect(r.status).toBe(409);
  });

  it('valida la entrada', async () => {
    const r = await httpClient(server.base).req('POST', '/auth/register', {
      email: 'x@correo.cl',
      name: 'X',
      password: 'corta',
    });
    expect(r.status).toBe(400);
  });
});

describe('login y logout', () => {
  it('mismo mensaje para contraseña mala y correo inexistente', async () => {
    const bad = await httpClient(server.base).req('POST', '/auth/login', {
      email: 'ana@correo.cl',
      password: 'incorrecta',
    });
    const missing = await httpClient(server.base).req('POST', '/auth/login', {
      email: 'nadie@correo.cl',
      password: 'incorrecta',
    });
    expect(bad.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(bad.data.message).toBe(missing.data.message);
  });

  it('login correcto → sesión; logout → sin sesión', async () => {
    const c = httpClient(server.base);
    expect((await c.req('POST', '/auth/login', { email: 'ana@correo.cl', password: 'secreta123' })).status).toBe(200);
    expect((await c.req('GET', '/boards')).status).toBe(200);
    expect((await c.req('POST', '/auth/logout')).status).toBe(204);
    expect(c.cookie).toBe('');
    expect((await c.req('GET', '/boards')).status).toBe(401);
  });

  it('rechaza un token falsificado', async () => {
    const r = await fetch(server.base + '/api/auth/me', {
      headers: { cookie: 'kanban_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma-falsa' },
    });
    expect(r.status).toBe(401);
  });
});

describe('rate limit', () => {
  it('bloquea tras demasiados intentos de login', async () => {
    const limited = await startServer({ authRateLimit: 3 });
    try {
      const c = httpClient(limited.base);
      const attempt = () => c.req('POST', '/auth/login', { email: 'ana@correo.cl', password: 'mala' });
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await attempt()).status);
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.app.close();
    }
  });
});

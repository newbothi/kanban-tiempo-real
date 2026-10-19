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

describe('S-02: el rate limit no se salta falseando la IP', () => {
  it('cambiar X-Forwarded-For en cada intento no evita el bloqueo', async () => {
    // Producción: un proxy delante (Azure), que AGREGA la IP real al final.
    const limited = await startServer({ authRateLimit: 3, trustProxy: 1 });
    try {
      const c = httpClient(limited.base);
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        const r = await c.req(
          'POST',
          '/auth/login',
          { email: `x${i}@correo.cl`, password: 'mala' },
          // La primera entrada la inventa el atacante; la última es la que agrega el proxy.
          { 'x-forwarded-for': `6.6.6.${i}, 203.0.113.5:${50000 + i}` },
        );
        statuses.push(r.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.app.close();
    }
  });

  it('cada correo tiene pocos intentos aunque se cambie de IP', async () => {
    const limited = await startServer({
      trustProxy: 1,
      loginThrottle: { freeAttempts: 2, baseMs: 60_000 },
    });
    try {
      const c = httpClient(limited.base);
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        const r = await c.req(
          'POST',
          '/auth/login',
          { email: 'victima@correo.cl', password: `intento-${i}` },
          { 'x-forwarded-for': `198.51.100.${i}` }, // una IP real distinta en cada intento
        );
        statuses.push(r.status);
      }
      // 2 fallos libres; el 3.º activa la espera, así que el 4.º intento ya recibe 429.
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.app.close();
    }
  });

  it('el bloqueo por correo responde igual exista o no la cuenta', async () => {
    const limited = await startServer({ loginThrottle: { freeAttempts: 0, baseMs: 60_000 } });
    try {
      const c = httpClient(limited.base);
      await c.req('POST', '/auth/register', { email: 'existe@correo.cl', name: 'Existe', password: 'una-clave-larga' });
      const out = [];
      for (const email of ['existe@correo.cl', 'noexiste@correo.cl']) {
        await c.req('POST', '/auth/login', { email, password: 'mala' });
        const r = await c.req('POST', '/auth/login', { email, password: 'mala' });
        out.push([r.status, r.data.error]);
      }
      expect(out).toEqual([
        [429, 'TooManyAttempts'],
        [429, 'TooManyAttempts'],
      ]);
    } finally {
      await limited.app.close();
    }
  });
});

describe('S-10: cerrar sesión revoca el token', () => {
  async function newUser(email: string, password = 'clave-revocable-1') {
    const c = httpClient(server.base);
    await c.req('POST', '/auth/register', { email, name: 'Usuario', password });
    return { c, password };
  }

  it('una cookie copiada antes del logout deja de servir', async () => {
    const { c } = await newUser('copiada@correo.cl');
    const robada = c.cookie;
    expect((await c.req('POST', '/auth/logout')).status).toBe(204);
    const r = await httpClient(server.base).req('GET', '/auth/me', undefined, { cookie: robada });
    expect(r.status).toBe(401);
  });

  it('cerrar sesión en un dispositivo la cierra en todos', async () => {
    const { password } = await newUser('dos-equipos@correo.cl');
    const pc = httpClient(server.base);
    const celular = httpClient(server.base);
    await pc.req('POST', '/auth/login', { email: 'dos-equipos@correo.cl', password });
    await celular.req('POST', '/auth/login', { email: 'dos-equipos@correo.cl', password });
    expect((await celular.req('GET', '/auth/me')).status).toBe(200);

    await pc.req('POST', '/auth/logout');
    expect((await celular.req('GET', '/auth/me')).status).toBe(401);

    // Volver a entrar funciona normal.
    const otra = httpClient(server.base);
    expect((await otra.req('POST', '/auth/login', { email: 'dos-equipos@correo.cl', password })).status).toBe(200);
    expect((await otra.req('GET', '/auth/me')).status).toBe(200);
  });

  it('la cuenta demo es compartida: el logout de un visitante no saca a los demás', async () => {
    const { password } = await newUser('demo@kanban.cl', 'clave-demo-de-test');
    const visitante1 = httpClient(server.base);
    const visitante2 = httpClient(server.base);
    await visitante1.req('POST', '/auth/login', { email: 'demo@kanban.cl', password });
    await visitante2.req('POST', '/auth/login', { email: 'demo@kanban.cl', password });
    await visitante1.req('POST', '/auth/logout');
    expect((await visitante2.req('GET', '/auth/me')).status).toBe(200);
  });

  it('un token vencido no sirve aunque la firma sea válida', async () => {
    const { c } = await newUser('vencido@correo.cl');
    const me = await c.req('GET', '/auth/me');
    const vencido = server.app.jwt.sign({ sub: me.data.id, sv: 0 }, { expiresIn: -10 });
    const r = await httpClient(server.base).req('GET', '/auth/me', undefined, { cookie: `kanban_session=${vencido}` });
    expect(r.status).toBe(401);
  });
});

describe('S-17: política de contraseñas en el registro', () => {
  it('rechaza contraseñas comunes', async () => {
    const r = await httpClient(server.base).req('POST', '/auth/register', {
      email: 'comun@correo.cl',
      name: 'Común',
      password: 'password123',
    });
    expect(r.status).toBe(400);
  });
});

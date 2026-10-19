import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer, MailMessage } from '../src/mail';
import { httpClient, prisma, registerUser, resetDb, startServer } from './helpers';

// Correo de prueba: guarda los mensajes en vez de enviarlos (y deja la verificación activa).
const outbox: MailMessage[] = [];
const mailer: Mailer = { enabled: true, send: async (m) => void outbox.push(m) };
const linkFor = (email: string) => {
  const msg = [...outbox].reverse().find((m) => m.to === email);
  return msg?.text.match(/https?:\/\/\S+/)?.[0];
};

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  await resetDb();
  server = await startServer({ mailer });
});
afterAll(() => server.app.close());

describe('S-09: verificación de correo', () => {
  it('al registrarse llega un enlace y la cuenta queda sin verificar', async () => {
    const eva = await registerUser(server.base, 'Eva');
    const me = (await eva.req('GET', '/auth/me')).data;
    expect(me).toMatchObject({ emailVerified: false, verificationRequired: true });
    expect(linkFor(eva.email)).toMatch(/\/api\/auth\/verify\?token=[\w-]{43}$/);
    // En la base solo queda el hash del token, nunca el token en claro.
    const user = await prisma.user.findUnique({ where: { email: eva.email } });
    expect(linkFor(eva.email)).not.toContain(user!.verifyTokenHash!);
  });

  it('sin verificar no se ven ni se aceptan invitaciones (alguien pudo registrar un correo ajeno)', async () => {
    const dueno = await registerUser(server.base, 'Dueno');
    const victima = await registerUser(server.base, 'Victima');
    const board = (await dueno.req('POST', '/boards', { name: 'Secreto' })).data.id;
    await dueno.req('POST', `/boards/${board}/members`, { email: victima.email });

    expect((await victima.req('GET', '/invites')).data).toEqual([]);
    const inv = await prisma.boardInvite.findFirst({ where: { email: victima.email } });
    const r = await victima.req('POST', `/invites/${inv!.id}/accept`);
    expect(r.status).toBe(403);
    expect(r.data.error).toBe('EmailNotVerified');
  });

  it('el enlace verifica la cuenta y redirige a la app', async () => {
    const fede = await registerUser(server.base, 'Fede');
    const link = new URL(linkFor(fede.email)!);
    const res = await fetch(server.base + link.pathname + link.search, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?verificado=1');
    expect((await fede.req('GET', '/auth/me')).data.emailVerified).toBe(true);

    // Un solo uso: el mismo enlace ya no sirve.
    const again = await fetch(server.base + link.pathname + link.search, { redirect: 'manual' });
    expect(again.headers.get('location')).toBe('/?verificado=0');
  });

  it('un token inventado o vencido no verifica nada', async () => {
    const gabi = await registerUser(server.base, 'Gabi');
    for (const token of ['x'.repeat(43), 'corto', "' OR 1=1 --"]) {
      const res = await fetch(`${server.base}/api/auth/verify?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
      expect(res.headers.get('location')).toBe('/?verificado=0');
    }
    await prisma.user.update({ where: { email: gabi.email }, data: { verifyTokenExpiresAt: new Date(Date.now() - 1000) } });
    const link = new URL(linkFor(gabi.email)!);
    const res = await fetch(server.base + link.pathname + link.search, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe('/?verificado=0');
  });

  it('se puede pedir otro correo, pero con límite', async () => {
    const hugo = await registerUser(server.base, 'Hugo');
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await hugo.req('POST', '/auth/verify/resend')).status);
    expect(statuses).toEqual([204, 204, 204, 429]);
  });
});

describe('S-18: cuenta demo', () => {
  async function demoLogin() {
    const c = httpClient(server.base);
    const r = await c.req('POST', '/auth/login', { email: 'demo@kanban.cl', password: 'clave-demo-de-test' });
    expect(r.status).toBe(200);
    return c;
  }

  beforeAll(async () => {
    await httpClient(server.base).req('POST', '/auth/register', {
      email: 'demo@kanban.cl',
      name: 'Usuario Demo',
      password: 'clave-demo-de-test',
    });
  });

  it('al primer ingreso se crean el tablero de bienvenida y el simulado', async () => {
    const demo = await demoLogin();
    expect((await demo.req('GET', '/auth/me')).data.isDemo).toBe(true);
    const names = (await demo.req('GET', '/boards')).data.map((b: { name: string }) => b.name).sort();
    expect(names).toEqual(['Mi primer tablero', 'Proyecto simulado · datos sintéticos']);
  });

  it('no puede invitar, quitar miembros, eliminar tableros ni aceptar invitaciones', async () => {
    const demo = await demoLogin();
    const [board] = (await demo.req('GET', '/boards')).data;
    const invite = await demo.req('POST', `/boards/${board.id}/members`, { email: 'alguien@correo.cl' });
    expect(invite.status).toBe(403);
    expect(invite.data.error).toBe('DemoRestricted');
    expect((await demo.req('DELETE', `/boards/${board.id}`)).status).toBe(403);

    const otro = await registerUser(server.base, 'Ivan');
    const suyo = (await otro.req('POST', '/boards', { name: 'De Iván' })).data.id;
    await otro.req('POST', `/boards/${suyo}/members`, { email: 'demo@kanban.cl' });
    const inv = await prisma.boardInvite.findFirst({ where: { email: 'demo@kanban.cl' } });
    expect((await demo.req('POST', `/invites/${inv!.id}/accept`)).status).toBe(403);
  });

  it('puede trabajar con tarjetas y crear tableros', async () => {
    const demo = await demoLogin();
    const b = (await demo.req('POST', '/boards', { name: 'De un visitante' })).data.id;
    const col = (await demo.req('GET', `/boards/${b}`)).data.columns[0].id;
    expect((await demo.req('POST', '/cards', { columnId: col, title: 'Hola' })).status).toBe(201);
  });

  it('se reinicia una vez al día: lo que dejó un visitante desaparece', async () => {
    let demo = await demoLogin(); // mismo día: no se reinicia
    let names = (await demo.req('GET', '/boards')).data.map((b: { name: string }) => b.name);
    expect(names).toContain('De un visitante');

    await prisma.user.update({
      where: { email: 'demo@kanban.cl' },
      data: { demoResetAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    demo = await demoLogin();
    names = (await demo.req('GET', '/boards')).data.map((b: { name: string }) => b.name).sort();
    expect(names).toEqual(['Mi primer tablero', 'Proyecto simulado · datos sintéticos']);
  });
});

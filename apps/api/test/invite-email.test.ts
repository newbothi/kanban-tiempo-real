import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer, MailMessage } from '../src/mail';
import { httpClient, prisma, registerUser, resetDb, startServer } from './helpers';

// Correo de prueba: guarda los mensajes en vez de enviarlos.
const outbox: MailMessage[] = [];
const mailer: Mailer = { enabled: true, send: async (m) => void outbox.push(m) };
const lastTo = (email: string) => [...outbox].reverse().find((m) => m.to === email);
const tokenFor = (email: string) => lastTo(email)?.text.match(/invitacion=([\w-]{43})/)?.[1];

let server: Awaited<ReturnType<typeof startServer>>;
let ana: Awaited<ReturnType<typeof registerUser>>;
let boardId: string;

beforeAll(async () => {
  await resetDb();
  server = await startServer({ mailer });
  ana = await registerUser(server.base, 'Ana');
  boardId = (await ana.req('POST', '/boards', { name: 'Plan <b>secreto</b>' })).data.id;
});
afterAll(() => server.app.close());

const preview = (token: string) =>
  fetch(`${server.base}/api/invites/preview?token=${encodeURIComponent(token)}`).then(async (r) => ({
    status: r.status,
    data: await r.json(),
  }));

describe('invitación por correo', () => {
  it('invitar manda un correo con el enlace, exista o no la cuenta', async () => {
    const r1 = await ana.req('POST', `/boards/${boardId}/members`, { email: 'nueva@correo.cl' });
    const r2 = await ana.req('POST', `/boards/${boardId}/members`, { email: 'beto@test.cl' });
    expect(r1.data).toEqual(r2.data); // misma respuesta: no revela qué correos tienen cuenta
    expect(tokenFor('nueva@correo.cl')).toBeDefined();
    expect(lastTo('nueva@correo.cl')!.subject).toContain('Ana te invitó');
  });

  it('el correo escapa el HTML del nombre del tablero', () => {
    const html = lastTo('nueva@correo.cl')!.html;
    expect(html).toContain('Plan &lt;b&gt;secreto&lt;/b&gt;');
    expect(html).not.toContain('<b>secreto</b>');
  });

  it('en la base solo queda el hash del token', async () => {
    const token = tokenFor('nueva@correo.cl')!;
    const invite = await prisma.boardInvite.findFirst({ where: { email: 'nueva@correo.cl' } });
    expect(invite!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invite!.tokenHash).not.toContain(token);
  });

  it('el enlace muestra quién invita, a qué tablero y con qué correo entrar', async () => {
    const r = await preview(tokenFor('nueva@correo.cl')!);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ boardName: 'Plan <b>secreto</b>', invitedBy: 'Ana', email: 'nueva@correo.cl' });
    expect((await preview('x'.repeat(43))).status).toBe(404);
  });

  it('con otra cuenta el enlace no sirve', async () => {
    const carla = await registerUser(server.base, 'Carla');
    const r = await carla.req('POST', '/invites/claim', { token: tokenFor('nueva@correo.cl') });
    expect(r.status).toBe(403);
    expect(r.data.error).toBe('WrongAccount');
    expect((await carla.req('GET', '/invites')).data).toEqual([]);
  });

  it('quien se registra con el correo invitado y abre el enlace queda verificado y puede aceptar', async () => {
    const token = tokenFor('nueva@correo.cl')!;
    const invitada = httpClient(server.base);
    await invitada.req('POST', '/auth/register', { email: 'nueva@correo.cl', name: 'Invitada', password: 'clave-invitada-1' });
    expect((await invitada.req('GET', '/auth/me')).data.emailVerified).toBe(false);
    expect((await invitada.req('GET', '/invites')).data).toEqual([]); // sin verificar, no ve nada

    const claim = await invitada.req('POST', '/invites/claim', { token });
    expect(claim.status).toBe(200);
    expect(claim.data.boardId).toBe(boardId);
    expect((await invitada.req('GET', '/auth/me')).data.emailVerified).toBe(true);

    const [inv] = (await invitada.req('GET', '/invites')).data;
    expect((await invitada.req('POST', `/invites/${inv.id}/accept`)).status).toBe(204);
    expect((await invitada.req('GET', '/boards')).data.map((b: { id: string }) => b.id)).toEqual([boardId]);
    // Respondida la invitación, el enlace deja de servir.
    expect((await preview(token)).status).toBe(404);
  });

  it('un enlace vencido o de una invitación cancelada no sirve', async () => {
    await ana.req('POST', `/boards/${boardId}/members`, { email: 'vence@correo.cl' });
    const token = tokenFor('vence@correo.cl')!;
    await prisma.boardInvite.updateMany({ where: { email: 'vence@correo.cl' }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    expect((await preview(token)).status).toBe(404);

    await ana.req('POST', `/boards/${boardId}/members`, { email: 'cancela@correo.cl' });
    const token2 = tokenFor('cancela@correo.cl')!;
    const [p] = (await ana.req('GET', `/boards/${boardId}/invites`)).data.filter((i: { email: string }) => i.email === 'cancela@correo.cl');
    await ana.req('DELETE', `/boards/${boardId}/invites/${p.id}`);
    expect((await preview(token2)).status).toBe(404);
  });

  it('a quien ya es miembro no se le manda correo', async () => {
    const before = outbox.length;
    await ana.req('POST', `/boards/${boardId}/members`, { email: 'nueva@correo.cl' });
    expect(outbox.length).toBe(before);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const beginSend = vi.fn();
vi.mock('@azure/communication-email', () => ({
  EmailClient: vi.fn(function (this: { beginSend: typeof beginSend }) {
    this.beginSend = beginSend;
  }),
}));

const { invitationEmail, mailerFromEnv, verificationEmail } = await import('../../src/mail');

const ENV_KEYS = ['ACS_CONNECTION_STRING', 'RESEND_API_KEY', 'MAIL_FROM', 'NODE_ENV'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const log = { info: vi.fn(), warn: vi.fn() };
const asLog = log as unknown as Parameters<typeof mailerFromEnv>[0];
const msg = { to: 'ana@ejemplo.cl', subject: 'Hola', text: 'texto', html: '<p>html</p>' };

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.clearAllMocks();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('mailerFromEnv: elige el proveedor según las variables', () => {
  it('con ACS y remitente envía por Azure Communication Services', async () => {
    process.env.ACS_CONNECTION_STRING = 'endpoint=https://x.communication.azure.com/;accesskey=abc';
    process.env.MAIL_FROM = 'DoNotReply@x.azurecomm.net';
    process.env.RESEND_API_KEY = 're_ignorada'; // ACS tiene prioridad
    const mailer = mailerFromEnv(asLog);
    expect(mailer.enabled).toBe(true);
    await mailer.send(msg);
    expect(beginSend).toHaveBeenCalledWith({
      senderAddress: 'DoNotReply@x.azurecomm.net',
      recipients: { to: [{ address: 'ana@ejemplo.cl' }] },
      content: { subject: 'Hola', plainText: 'texto', html: '<p>html</p>' },
    });
  });

  it('con Resend envía por su API, con timeout, y falla si Resend responde error', async () => {
    process.env.RESEND_API_KEY = 're_123';
    process.env.MAIL_FROM = 'kanban@ejemplo.cl';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const mailer = mailerFromEnv(asLog);
    await mailer.send(msg);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_123');
    expect(JSON.parse(init.body)).toMatchObject({ from: 'kanban@ejemplo.cl', to: ['ana@ejemplo.cl'] });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    fetchMock.mockResolvedValueOnce(new Response('no', { status: 422 }));
    await expect(mailer.send(msg)).rejects.toThrow('Resend respondió 422');
  });

  it('sin remitente no activa ningún proveedor', () => {
    process.env.ACS_CONNECTION_STRING = 'endpoint=https://x/;accesskey=abc';
    expect(mailerFromEnv(asLog).enabled).toBe(false);
  });

  it('desactivado en desarrollo deja el enlace en el log para poder probar', async () => {
    const mailer = mailerFromEnv(asLog);
    expect(mailer.enabled).toBe(false);
    await mailer.send(msg);
    expect(log.info).toHaveBeenCalledWith({ to: 'ana@ejemplo.cl', text: 'texto' }, 'correo (no enviado)');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('desactivado en producción avisa al arrancar y nunca escribe el contenido en el log', async () => {
    process.env.NODE_ENV = 'production';
    const mailer = mailerFromEnv(asLog);
    expect(log.warn).toHaveBeenCalledOnce();
    await mailer.send(msg);
    expect(log.info).not.toHaveBeenCalled();
  });
});

describe('plantillas de correo', () => {
  it('la verificación escapa el nombre en el HTML', () => {
    const m = verificationEmail('<b>Ana</b>', 'https://app/?verificar=x"y');
    expect(m.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(m.html).toContain('href="https://app/?verificar=x&quot;y"');
    expect(m.text).toContain('<b>Ana</b>'); // el texto plano no interpreta HTML
  });

  it('la invitación aplana el asunto a una línea (sin inyección de cabeceras)', () => {
    const m = invitationEmail('Ana\r\nBcc: otro@x.cl', 'Tablero\nnuevo', 'https://app/?invitacion=t');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain('Ana Bcc: otro@x.cl');
  });
});

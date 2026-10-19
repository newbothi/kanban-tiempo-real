import type { FastifyBaseLogger } from 'fastify';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Envío de correos (S-09). Con RESEND_API_KEY y MAIL_FROM configurados se usa Resend;
 * si no, el envío queda desactivado y la verificación de correo no se exige
 * (`enabled = false`), para que la app siga funcionando en desarrollo y en los tests.
 */
export interface Mailer {
  readonly enabled: boolean;
  send(msg: MailMessage): Promise<void>;
}

class ResendMailer implements Mailer {
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(msg: MailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
  }
}

class DisabledMailer implements Mailer {
  readonly enabled = false;

  constructor(private readonly log?: FastifyBaseLogger) {}

  async send(msg: MailMessage) {
    // Sin servicio de correo: en desarrollo se deja el enlace en el log para poder probar.
    if (process.env.NODE_ENV !== 'production') this.log?.info({ to: msg.to, text: msg.text }, 'correo (no enviado)');
  }
}

export function mailerFromEnv(log?: FastifyBaseLogger): Mailer {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (key && from) return new ResendMailer(key, from);
  if (process.env.NODE_ENV === 'production') {
    log?.warn('Sin RESEND_API_KEY/MAIL_FROM: la verificación de correo está desactivada');
  }
  return new DisabledMailer(log);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function verificationEmail(name: string, link: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'Confirma tu correo · Kanban en tiempo real',
    text: `Hola ${name}:\n\nConfirma tu correo abriendo este enlace (vence en 24 horas):\n${link}\n\nSi no creaste una cuenta, ignora este mensaje.`,
    html: `<p>Hola ${escapeHtml(name)}:</p><p>Confirma tu correo con este enlace (vence en 24 horas):</p><p><a href="${escapeHtml(link)}">Confirmar mi correo</a></p><p>Si no creaste una cuenta, ignora este mensaje.</p>`,
  };
}

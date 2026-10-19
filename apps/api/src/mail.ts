import type { FastifyBaseLogger } from 'fastify';
import { EmailClient } from '@azure/communication-email';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Envío de correos (verificación e invitaciones). Proveedores, en orden:
 * - Azure Communication Services: ACS_CONNECTION_STRING + MAIL_FROM.
 * - Resend: RESEND_API_KEY + MAIL_FROM.
 * Sin ninguno, el envío queda desactivado y la verificación de correo no se exige
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

class AcsMailer implements Mailer {
  readonly enabled = true;
  private readonly client: EmailClient;

  constructor(
    connectionString: string,
    private readonly from: string,
  ) {
    this.client = new EmailClient(connectionString);
  }

  async send(msg: MailMessage) {
    // beginSend vuelve apenas Azure acepta el mensaje; no esperamos la entrega (tarda segundos).
    await this.client.beginSend({
      senderAddress: this.from,
      recipients: { to: [{ address: msg.to }] },
      content: { subject: msg.subject, plainText: msg.text, html: msg.html },
    });
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
  const from = process.env.MAIL_FROM;
  const acs = process.env.ACS_CONNECTION_STRING;
  const key = process.env.RESEND_API_KEY;
  if (acs && from) return new AcsMailer(acs, from);
  if (key && from) return new ResendMailer(key, from);
  if (process.env.NODE_ENV === 'production') {
    log?.warn('Sin servicio de correo (ACS_CONNECTION_STRING o RESEND_API_KEY, y MAIL_FROM): no se envían correos');
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

export function invitationEmail(inviter: string, boardName: string, link: string): Omit<MailMessage, 'to'> {
  const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();
  return {
    subject: `${oneLine(inviter)} te invitó a «${oneLine(boardName)}» · Kanban en tiempo real`,
    text:
      `${inviter} te invitó a colaborar en el tablero «${boardName}».\n\n` +
      `Abre este enlace para verla (vence en 14 días):\n${link}\n\n` +
      'Si no tienes cuenta, podrás crearla con este mismo correo. Si no esperabas esta invitación, ignora este mensaje.',
    html:
      `<p><strong>${escapeHtml(inviter)}</strong> te invitó a colaborar en el tablero <strong>«${escapeHtml(boardName)}»</strong>.</p>` +
      `<p><a href="${escapeHtml(link)}">Ver la invitación</a> (vence en 14 días)</p>` +
      '<p>Si no tienes cuenta, podrás crearla con este mismo correo. Si no esperabas esta invitación, ignora este mensaje.</p>',
  };
}

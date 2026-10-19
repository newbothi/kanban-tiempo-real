import type { FastifyInstance } from 'fastify';
import { claimInviteSchema, type InviteDto, type InvitePreviewDto } from '@kanban/shared';
import { prisma } from '../db';
import { TOKEN_FORMAT, hashToken, limitWrites, notFound, parseOr400, rejectMalformedIds } from '../http';
import { notify } from '../realtime';
import { rejectIfDemo } from '../demo/demo';
import type { Mailer } from '../mail';
import type { RouteOptions } from './boards';

/** Invitaciones que recibí (S-08). Se buscan por mi correo. */
export async function inviteRoutes(app: FastifyInstance, opts: Pick<RouteOptions, 'writes'> & { mailer: Mailer }) {
  app.addHook('preValidation', rejectMalformedIds);
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', limitWrites(opts.writes));

  /**
   * S-09: con verificación activa, una cuenta sin correo confirmado no ve invitaciones.
   * Si no, cualquiera podría registrar el correo de otra persona y quedarse con lo que le envían.
   */
  async function me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user) return null;
    return { email: user.email, canUseInvites: !opts.mailer.enabled || user.emailVerifiedAt !== null };
  }

  app.get('/invites', async (req) => {
    const user = await me(req.user.sub);
    if (!user?.canUseInvites) return [];
    const invites = await prisma.boardInvite.findMany({
      where: { email: user.email },
      orderBy: { createdAt: 'desc' },
      select: { id: true, boardId: true, createdAt: true, invitedById: true, board: { select: { name: true } } },
    });
    const inviters = await prisma.user.findMany({
      where: { id: { in: [...new Set(invites.map((i) => i.invitedById))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(inviters.map((u) => [u.id, u.name]));
    return invites.map(
      (i): InviteDto => ({
        id: i.id,
        boardId: i.boardId,
        boardName: i.board.name,
        invitedBy: nameOf.get(i.invitedById) ?? 'Alguien',
        createdAt: i.createdAt.toISOString(),
      }),
    );
  });

  /**
   * Abrir el enlace del correo con sesión iniciada. Si la sesión es del correo invitado,
   * eso prueba que la persona controla ese correo: la cuenta queda verificada y la
   * invitación aparece en su lista para aceptarla. Con otra cuenta no sirve.
   */
  app.post('/invites/claim', async (req, reply) => {
    const input = parseOr400(claimInviteSchema, req.body, reply);
    if (!input) return;
    const invite = await findByLink(input.token);
    if (!invite) return reply.code(404).send({ error: 'NotFound', message: 'La invitación no existe, ya se respondió o venció' });

    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { email: true, emailVerifiedAt: true } });
    if (!user || user.email !== invite.email) {
      return reply.code(403).send({
        error: 'WrongAccount',
        message: `Esta invitación es para ${invite.email}. Cierra sesión y entra (o crea tu cuenta) con ese correo.`,
      });
    }
    if (!user.emailVerifiedAt) {
      await prisma.user.update({ where: { id: req.user.sub }, data: { emailVerifiedAt: new Date() } });
    }
    notify.invitesChanged(req.user.sub);
    return { inviteId: invite.id, boardId: invite.boardId };
  });

  app.post<{ Params: { id: string } }>('/invites/:id/accept', async (req, reply) => {
    const user = await me(req.user.sub);
    const invite = await prisma.boardInvite.findUnique({ where: { id: req.params.id } });
    // Una invitación que no es para mi correo es como si no existiera.
    if (!user || !invite || invite.email !== user.email) return notFound(reply, 'La invitación');
    if (await rejectIfDemo(reply, req.user.sub, 'aceptar invitaciones')) return;
    if (!user.canUseInvites) {
      return reply
        .code(403)
        .send({ error: 'EmailNotVerified', message: 'Confirma tu correo antes de aceptar invitaciones' });
    }

    await prisma.$transaction(async (tx) => {
      const already = await tx.boardMember.findUnique({
        where: { boardId_userId: { boardId: invite.boardId, userId: req.user.sub } },
      });
      if (!already) await tx.boardMember.create({ data: { boardId: invite.boardId, userId: req.user.sub, role: 'member' } });
      await tx.boardInvite.delete({ where: { id: invite.id } });
    });
    notify.memberAdded(invite.boardId, req.user.sub);
    notify.invitesChanged(req.user.sub);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>('/invites/:id', async (req, reply) => {
    const user = await me(req.user.sub);
    const invite = await prisma.boardInvite.findUnique({ where: { id: req.params.id } });
    if (!user || !invite || invite.email !== user.email) return notFound(reply, 'La invitación');
    await prisma.boardInvite.delete({ where: { id: invite.id } });
    notify.pendingInvitesChanged(invite.boardId);
    notify.invitesChanged(req.user.sub);
    return reply.code(204).send();
  });
}

/** Invitación vigente que corresponde al token de un enlace. */
async function findByLink(token: string) {
  if (!TOKEN_FORMAT.test(token)) return null;
  return prisma.boardInvite.findFirst({
    where: { tokenHash: hashToken(token), tokenExpiresAt: { gt: new Date() } },
    select: { id: true, boardId: true, email: true, invitedById: true, board: { select: { name: true } } },
  });
}

/**
 * Vista previa pública del enlace: quien lo tiene recibió el correo, así que puede ver
 * quién lo invita, a qué tablero y con qué correo debe entrar. Con límite por IP.
 */
export async function inviteLinkRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>(
    '/invites/preview',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const invite = await findByLink(req.query.token ?? '');
      if (!invite) return reply.code(404).send({ error: 'NotFound', message: 'La invitación no existe, ya se respondió o venció' });
      const inviter = await prisma.user.findUnique({ where: { id: invite.invitedById }, select: { name: true } });
      return {
        boardName: invite.board.name,
        invitedBy: inviter?.name ?? 'Alguien',
        email: invite.email,
      } satisfies InvitePreviewDto;
    },
  );
}

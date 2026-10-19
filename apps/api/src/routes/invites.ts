import type { FastifyInstance } from 'fastify';
import type { InviteDto } from '@kanban/shared';
import { prisma } from '../db';
import { limitWrites, notFound, rejectMalformedIds } from '../http';
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

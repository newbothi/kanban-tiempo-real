import { useEffect, useState } from 'react';
import type { UserDto } from '@kanban/shared';
import { useClaimInvite, useInvites, useResendVerification, useRespondInvite } from '../api/queries';
import { clearInviteToken, inviteTokenFromUrl } from '../api/inviteLink';
import { showToast } from '../ui/toast-store';

/** Avisos de la cuenta: correo sin verificar, cuenta demo e invitaciones recibidas. */
export function AccountNotices({ me, onJoined }: { me: UserDto; onJoined: (boardId: string) => void }) {
  const invites = useInvites();
  const respond = useRespondInvite();
  const resend = useResendVerification();
  const [resent, setResent] = useState(false);
  useVerificationResultToast();
  useInviteLink();

  const mustVerify = me.verificationRequired && !me.emailVerified;

  return (
    <>
      {mustVerify && (
        <p className="notice notice--warning" role="status">
          Confirma tu correo (<strong>{me.email}</strong>) para poder recibir invitaciones a tableros.{' '}
          {resent ? (
            'Te enviamos un correo nuevo.'
          ) : (
            <button
              className="link"
              disabled={resend.isPending}
              onClick={() => resend.mutate(undefined, { onSuccess: () => setResent(true) })}
            >
              Reenviar el correo
            </button>
          )}
        </p>
      )}

      {me.isDemo && (
        <p className="notice" role="note">
          Estás en la <strong>cuenta demo</strong>: puedes crear tableros y mover tarjetas, pero no invitar ni
          eliminar. Se reinicia cada día. Crea tu propia cuenta para probar todo.
        </p>
      )}

      {invites.data && invites.data.length > 0 && (
        <section className="invites" aria-label="Invitaciones">
          {invites.data.map((inv) => (
            <div className="invites__item" key={inv.id}>
              <span>
                <strong>{inv.invitedBy}</strong> te invitó a «{inv.boardName}»
              </span>
              <span className="invites__actions">
                <button
                  className="primary"
                  disabled={respond.isPending}
                  onClick={() =>
                    respond.mutate({ id: inv.id, accept: true }, { onSuccess: () => onJoined(inv.boardId) })
                  }
                >
                  Aceptar
                </button>
                <button
                  className="link"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ id: inv.id, accept: false })}
                >
                  Rechazar
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/** Si la app se abrió desde el correo de invitación, la reclama una vez (ya hay sesión). */
function useInviteLink() {
  const claim = useClaimInvite();
  useEffect(() => {
    const token = inviteTokenFromUrl();
    if (!token) return;
    clearInviteToken();
    claim.mutate(token, {
      onSuccess: () => showToast('Tienes una invitación: acéptala o recházala arriba.'),
      onError: (err) => showToast(err.message),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** El enlace del correo vuelve a la app con ?verificado=1 (o 0): se avisa y se limpia la URL. */
function useVerificationResultToast() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('verificado');
    if (result === null) return;
    showToast(result === '1' ? 'Tu correo quedó confirmado.' : 'El enlace no es válido o ya venció. Pide uno nuevo.');
    history.replaceState(null, '', location.pathname + location.hash);
  }, []);
}

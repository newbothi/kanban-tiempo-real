import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { UserDto } from '@kanban/shared';
import { AccountNotices } from '../src/components/AccountNotices';
import { installApi, reply } from './fake-api';
import { fakeSocket } from './fake-socket';
import { ana } from './fixtures';
import { renderApp, renderWithClient } from './render';

const TOKEN = 'b'.repeat(43);
const invite = { id: 'i-1', boardId: 'b-9', boardName: 'Marketing', invitedBy: 'Beto', createdAt: '2026-10-19T10:00:00Z' };

function notices(me: UserDto, routes: Parameters<typeof installApi>[0] = {}) {
  const api = installApi({ 'GET /invites': () => [], ...routes });
  const onJoined = vi.fn();
  renderWithClient(<AccountNotices me={me} onJoined={onJoined} />);
  return { api, onJoined };
}

describe('avisos de la cuenta', () => {
  it('pide confirmar el correo y permite reenviarlo una vez', async () => {
    const { api } = notices(
      { ...ana, emailVerified: false, verificationRequired: true },
      { 'POST /auth/verify/resend': () => undefined },
    );
    const user = userEvent.setup();
    expect(screen.getByText(/Confirma tu correo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reenviar el correo' }));
    expect(await screen.findByText(/Te enviamos un correo nuevo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenviar el correo' })).not.toBeInTheDocument();
    expect(api.callsTo('POST /auth/verify/resend')).toHaveLength(1);
  });

  it('sin envío de correos configurado no pide confirmar nada', () => {
    notices({ ...ana, emailVerified: false, verificationRequired: false });
    expect(screen.queryByText(/Confirma tu correo/)).not.toBeInTheDocument();
  });

  it('la cuenta demo explica sus límites', () => {
    notices({ ...ana, isDemo: true });
    expect(screen.getByRole('note')).toHaveTextContent('cuenta demo');
  });

  it('muestra las invitaciones; aceptar lleva al tablero', async () => {
    const { api, onJoined } = notices(ana, {
      'GET /invites': () => [invite],
      'POST /invites/:id/accept': () => undefined,
    });
    const user = userEvent.setup();
    expect(await screen.findByText(/te invitó a «Marketing»/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('b-9'));
    expect(api.callsTo('POST /invites/i-1/accept')).toHaveLength(1);
  });

  it('rechazar no lleva a ningún tablero', async () => {
    const { api, onJoined } = notices(ana, {
      'GET /invites': () => [invite],
      'DELETE /invites/:id': () => undefined,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rechazar' }));
    await waitFor(() => expect(api.callsTo('DELETE /invites/i-1')).toHaveLength(1));
    expect(onJoined).not.toHaveBeenCalled();
  });

  it('si responder falla, avisa', async () => {
    notices(ana, {
      'GET /invites': () => [invite],
      'POST /invites/:id/accept': () => reply(403, { message: 'Confirma tu correo antes de aceptar' }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByText(/No se pudo responder la invitación. Confirma tu correo/)).toBeInTheDocument();
  });
});

describe('enlaces que vuelven desde el correo', () => {
  it('con sesión, el enlace de invitación se reclama una sola vez y se limpia de la URL', async () => {
    history.replaceState(null, '', `/?invitacion=${TOKEN}#b-1`);
    const { api } = notices(ana, { 'POST /invites/claim': () => ({ inviteId: 'i-1', boardId: 'b-9' }) });
    expect(await screen.findByText(/Tienes una invitación/)).toBeInTheDocument();
    expect(api.callsTo('POST /invites/claim')).toHaveLength(1);
    expect(api.callsTo('POST /invites/claim')[0].body).toEqual({ token: TOKEN });
    expect(location.search).toBe('');
    expect(location.hash).toBe('#b-1');
  });

  it('si el enlace es para otra cuenta, lo explica', async () => {
    history.replaceState(null, '', `/?invitacion=${TOKEN}`);
    notices(ana, {
      'POST /invites/claim': () => reply(403, { message: 'Esta invitación es para otro correo' }),
    });
    expect(await screen.findByText('Esta invitación es para otro correo')).toBeInTheDocument();
  });

  it('?verificado=1 confirma el correo y se limpia de la URL', async () => {
    history.replaceState(null, '', '/?verificado=1');
    notices(ana);
    expect(await screen.findByText('Tu correo quedó confirmado.')).toBeInTheDocument();
    expect(location.search).toBe('');
  });

  it('?verificado=0 avisa que el enlace no sirve', async () => {
    history.replaceState(null, '', '/?verificado=0');
    notices(ana);
    expect(await screen.findByText(/no es válido o ya venció/)).toBeInTheDocument();
  });

  it('una invitación nueva (o verificar el correo en otra pestaña) se refleja al tiro', async () => {
    let list: (typeof invite)[] = [];
    installApi({
      'GET /auth/me': () => ana,
      'GET /boards': () => [],
      'GET /invites': () => list,
    });
    renderApp();
    await screen.findByText(/Aún no tienes tableros/);
    list = [invite];
    act(() => fakeSocket.serverEmit('invites:changed'));
    expect(await screen.findByText(/te invitó a «Marketing»/)).toBeInTheDocument();
  });

  it('si el servidor rechaza el socket por sesión vencida, vuelve a consultar la sesión', async () => {
    let meCalls = 0;
    installApi({
      'GET /auth/me': () => (++meCalls === 1 ? ana : reply(401, { message: 'No autenticado' })),
      'GET /boards': () => [],
      'GET /invites': () => [],
    });
    renderApp();
    await screen.findByText(/Aún no tienes tableros/);
    act(() => fakeSocket.serverEmit('connect_error', new Error('unauthorized')));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MemberDto, UserDto } from '@kanban/shared';
import { MembersPanel } from '../src/components/MembersPanel';
import { installApi, reply } from './fake-api';
import { ana, beto } from './fixtures';
import { renderWithClient } from './render';

const members: MemberDto[] = [
  { userId: ana.id, name: 'Ana', email: ana.email, role: 'owner' },
  { userId: beto.id, name: 'Beto', email: beto.email, role: 'member' },
];

function api(extra: Parameters<typeof installApi>[0] = {}) {
  return installApi({
    'GET /boards/:id/members': () => members,
    'GET /boards/:id/invites': () => [{ id: 'i-1', email: 'carla@ejemplo.cl', createdAt: '2026-10-19T10:00:00Z' }],
    ...extra,
  });
}

function panel(me: UserDto, role: 'owner' | 'member', onLeft = vi.fn()) {
  renderWithClient(<MembersPanel boardId="b-1" myRole={role} me={me} onLeft={onLeft} />);
  return onLeft;
}

describe('panel de miembros (dueño)', () => {
  it('lista a los miembros, marca al dueño y a uno mismo', async () => {
    api();
    panel(ana, 'owner');
    expect(await screen.findByText('Ana (tú)')).toBeInTheDocument();
    expect(screen.getByText('Dueño')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument(); // a Beto, no a sí mismo
  });

  it('valida el correo antes de invitar', async () => {
    const calls = api();
    panel(ana, 'owner');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Invitar por correo'), 'no-es-correo');
    await user.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(await screen.findByText(/correo/i, { selector: '.status--error' })).toBeInTheDocument();
    expect(calls.callsTo('POST /boards/b-1/members')).toHaveLength(0);
  });

  it('al invitar muestra la respuesta del servidor (igual exista o no la cuenta)', async () => {
    const calls = api({ 'POST /boards/:id/members': () => reply(202, { message: 'Si el correo es válido, le llegará la invitación.' }) });
    panel(ana, 'owner');
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Invitar por correo');
    await user.type(input, 'carla@ejemplo.cl');
    await user.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(await screen.findByText('Si el correo es válido, le llegará la invitación.')).toHaveAttribute('role', 'status');
    expect(input).toHaveValue('');
    expect(calls.callsTo('POST /boards/b-1/members')[0].body).toEqual({ email: 'carla@ejemplo.cl' });
  });

  it('si la invitación falla, muestra el motivo', async () => {
    api({ 'POST /boards/:id/members': () => reply(429, { message: 'Demasiadas invitaciones' }) });
    panel(ana, 'owner');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Invitar por correo'), 'carla@ejemplo.cl');
    await user.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(await screen.findByText('Demasiadas invitaciones')).toBeInTheDocument();
  });

  it('puede cancelar una invitación pendiente y quitar a un miembro', async () => {
    const calls = api({
      'DELETE /boards/:id/invites/:inviteId': () => undefined,
      'DELETE /boards/:id/members/:userId': () => undefined,
    });
    panel(ana, 'owner');
    const user = userEvent.setup();
    const pending = (await screen.findByText('carla@ejemplo.cl')).closest('li') as HTMLElement;
    await user.click(within(pending).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() => {
      expect(calls.callsTo('DELETE /boards/b-1/invites/i-1')).toHaveLength(1);
      expect(calls.callsTo(`DELETE /boards/b-1/members/${beto.id}`)).toHaveLength(1);
    });
  });

  it('la cuenta demo no puede invitar ni quitar, y no consulta las invitaciones', async () => {
    const calls = api();
    panel({ ...ana, isDemo: true }, 'owner');
    expect(await screen.findByText(/La cuenta demo no puede invitar/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(calls.callsTo('GET /boards/b-1/invites')).toHaveLength(0);
  });
});

describe('panel de miembros (miembro)', () => {
  it('no ve el formulario de invitación ni las invitaciones pendientes', async () => {
    const calls = api();
    panel(beto, 'member');
    expect(await screen.findByText('Beto (tú)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Invitar por correo')).not.toBeInTheDocument();
    expect(calls.callsTo('GET /boards/b-1/invites')).toHaveLength(0);
  });

  it('puede salir del tablero, con confirmación', async () => {
    const calls = api({ 'DELETE /boards/:id/members/:userId': () => undefined });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onLeft = panel(beto, 'member');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Salir del tablero' }));
    expect(calls.callsTo(`DELETE /boards/b-1/members/${beto.id}`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Salir del tablero' }));
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
  });

  it('si no se pueden cargar los miembros, lo muestra', async () => {
    api({ 'GET /boards/:id/members': () => reply(404, { message: 'Tablero no encontrado' }) });
    panel(beto, 'member');
    expect(await screen.findByText('Tablero no encontrado')).toBeInTheDocument();
  });
});

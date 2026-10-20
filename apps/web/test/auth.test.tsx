import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { installApi, reply } from './fake-api';
import { fakeSocket } from './fake-socket';
import { ana, makeBoard } from './fixtures';
import { renderApp } from './render';

const TOKEN = 'a'.repeat(43);

function loggedOutApi(extra: Parameters<typeof installApi>[0] = {}) {
  return installApi({
    'GET /auth/me': () => reply(401, { message: 'No autenticado' }),
    'GET /boards': () => [{ id: 'b-1', name: 'Proyecto', role: 'owner' }],
    'GET /boards/:id': () => makeBoard(),
    'GET /boards/:id/metrics': () => reply(503, { message: 'no disponible' }),
    'GET /invites': () => [],
    ...extra,
  });
}

describe('pantalla de acceso', () => {
  it('sin sesión muestra el login y valida en el cliente antes de llamar a la API', async () => {
    const api = loggedOutApi();
    renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/correo/i);
    expect(api.callsTo('POST /auth/login')).toHaveLength(0);
  });

  it('muestra el error del servidor si las credenciales no sirven (sin cerrar la sesión)', async () => {
    loggedOutApi({ 'POST /auth/login': () => reply(401, { message: 'Correo o contraseña incorrectos' }) });
    renderApp();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Correo'), 'ana@ejemplo.cl');
    await user.type(screen.getByLabelText('Contraseña'), 'equivocada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('al entrar abre el espacio de trabajo y conecta el socket con la cookie nueva', async () => {
    const api = loggedOutApi({ 'POST /auth/login': () => ana });
    renderApp();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Correo'), 'ana@ejemplo.cl');
    await user.type(screen.getByLabelText('Contraseña'), 'contraseña-segura');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Proyecto' })).toBeInTheDocument();
    expect(api.callsTo('POST /auth/login')[0].body).toEqual({
      email: 'ana@ejemplo.cl',
      password: 'contraseña-segura',
    });
    expect(fakeSocket.connected).toBe(true);
  });

  it('crear cuenta exige nombre y una contraseña no común', async () => {
    const api = loggedOutApi({ 'POST /auth/register': () => ({ ...ana, name: 'Nueva' }) });
    renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Crear cuenta' }));
    await user.type(screen.getByLabelText('Correo'), 'nueva@ejemplo.cl');
    await user.type(screen.getByLabelText('Contraseña'), 'password');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa tu nombre');

    await user.type(screen.getByLabelText('Nombre'), 'Nueva');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/común|8 caracteres/);

    await user.clear(screen.getByLabelText('Contraseña'));
    await user.type(screen.getByLabelText('Contraseña'), 'una frase larga y rara');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Nueva')).toBeInTheDocument();
    expect(api.callsTo('POST /auth/register')).toHaveLength(1);
  });

  it('cambiar de pestaña limpia el error anterior', async () => {
    loggedOutApi();
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Crear cuenta' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('el enlace del correo muestra quién invita y completa el correo invitado', async () => {
    history.replaceState(null, '', `/?invitacion=${TOKEN}`);
    loggedOutApi({
      'GET /invites/preview': (_b, url) => {
        expect(url.searchParams.get('token')).toBe(TOKEN);
        return { boardName: 'Marketing', invitedBy: 'Beto', email: 'ana@ejemplo.cl' };
      },
    });
    renderApp();

    expect(await screen.findByText(/te invitó a «Marketing»/)).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toHaveValue('ana@ejemplo.cl');
  });

  it('el correo invitado se puede cambiar a mano (no se vuelve a pisar)', async () => {
    history.replaceState(null, '', `/?invitacion=${TOKEN}`);
    loggedOutApi({
      'GET /invites/preview': () => ({ boardName: 'Marketing', invitedBy: 'Beto', email: 'ana@ejemplo.cl' }),
    });
    renderApp();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Correo');
    await waitFor(() => expect(input).toHaveValue('ana@ejemplo.cl'));
    await user.clear(input);
    await user.type(input, 'otra@ejemplo.cl');
    expect(input).toHaveValue('otra@ejemplo.cl');
  });

  it('un enlace vencido avisa y no completa nada', async () => {
    history.replaceState(null, '', `/?invitacion=${TOKEN}`);
    loggedOutApi({ 'GET /invites/preview': () => reply(404, { message: 'No existe' }) });
    renderApp();
    expect(await screen.findByText(/no es válido o ya venció/)).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toHaveValue('');
  });

  it('un token con formato inválido en la URL ni siquiera se consulta', async () => {
    history.replaceState(null, '', '/?invitacion=<script>');
    const api = loggedOutApi();
    renderApp();
    await screen.findByRole('button', { name: 'Entrar' });
    expect(api.calls.some((c) => c.path.startsWith('/invites/preview'))).toBe(false);
  });

  it('si la API no responde, lo dice en vez de quedarse cargando', async () => {
    installApi({ 'GET /auth/me': () => reply(500, { message: 'error' }) });
    renderApp();
    expect(await screen.findByText(/No se pudo conectar con la API/)).toBeInTheDocument();
  });
});

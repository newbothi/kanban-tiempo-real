import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api, setUnauthorizedHandler } from '../src/api/client';
import { describeError } from '../src/api/queryClient';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { Toaster } from '../src/ui/toast';
import { getToasts, showToast } from '../src/ui/toast-store';
import { installApi, reply } from './fake-api';

describe('avisos (toasts)', () => {
  it('muestra el aviso, no lo repite si ya está en pantalla y se cierra con el botón', async () => {
    render(<Toaster />);
    const user = userEvent.setup();
    act(() => {
      showToast('Guardado');
      showToast('Guardado');
    });
    expect(screen.getAllByText('Guardado')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByText('Guardado')).not.toBeInTheDocument();
  });

  it('se cierra solo después de unos segundos', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => showToast('Temporal', 3000));
    expect(screen.getByText('Temporal')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText('Temporal')).not.toBeInTheDocument();
    expect(getToasts()).toHaveLength(0);
  });
});

describe('ErrorBoundary', () => {
  it('si un componente falla al renderizar, muestra un aviso en vez de una pantalla en blanco', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Roto = () => {
      throw new Error('boom');
    };
    render(
      <ErrorBoundary>
        <Roto />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Algo salió mal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
  });
});

describe('cliente HTTP', () => {
  it('un 401 fuera de /auth avisa que la sesión venció; en el login no', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    installApi({
      'GET /boards': () => reply(401, { message: 'No autenticado' }),
      'POST /auth/login': () => reply(401, { message: 'Correo o contraseña incorrectos' }),
    });
    await expect(api.listBoards()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(api.login({ email: 'a@b.cl', password: 'x' })).rejects.toThrow('Correo o contraseña incorrectos');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(() => {});
  });

  it('usa el primer mensaje de validación de Zod si viene', async () => {
    installApi({
      'POST /boards': () => reply(400, { message: 'Datos inválidos', issues: [{ message: 'El nombre es obligatorio' }] }),
    });
    await expect(api.createBoard({ name: '' })).rejects.toThrow('El nombre es obligatorio');
  });

  it('si la respuesta de error no es JSON, usa el código', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    const err = await api.listBoards().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Error 502');
  });

  it('204 devuelve undefined, y nunca manda cookies a otro origen', async () => {
    const fake = installApi({ 'DELETE /cards/:id': () => undefined });
    await expect(api.deleteCard('k-1')).resolves.toBeUndefined();
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(fake.calls[0].path).toBe('/cards/k-1');
  });

  it('describeError: mensajes para el usuario según el tipo de error', () => {
    expect(describeError(new ApiError(401, 'x'))).toBeNull();
    expect(describeError(new ApiError(503, 'detalle interno'))).toBe('El servidor tuvo un problema. Intenta de nuevo.');
    expect(describeError(new ApiError(403, 'Solo el dueño'))).toBe('Solo el dueño');
    expect(describeError(new TypeError('Failed to fetch'))).toBe('No hay conexión con el servidor.');
  });
});

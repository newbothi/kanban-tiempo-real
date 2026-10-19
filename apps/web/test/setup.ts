import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { fakeSocket } from './fake-socket';

// El socket real se reemplaza por uno falso en TODOS los tests.
vi.mock('../src/realtime/socket', () => ({
  socket: fakeSocket,
  connectSocket: () => {
    if (fakeSocket.connected) fakeSocket.disconnect();
    fakeSocket.connect();
  },
  disconnectSocket: () => fakeSocket.disconnect(),
  ensureSocket: () => {
    if (!fakeSocket.active) fakeSocket.connect();
  },
}));

// jsdom no trae ResizeObserver (lo usan los gráficos).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

beforeEach(() => {
  fakeSocket.reset();
  history.replaceState(null, '', '/');
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // Cierra los avisos que hayan quedado en pantalla.
  const { getToasts, dismiss } = await import('../src/ui/toast-store');
  for (const t of getToasts()) dismiss(t.id);
});

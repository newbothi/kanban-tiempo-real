import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
}

// Pequeño store global: cualquier parte de la app (incluso fuera de React) puede mostrar un aviso.
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(message: string, ms = 5000) {
  // Evita repetir el mismo aviso si ya está en pantalla.
  if (toasts.some((t) => t.message === message)) return;
  const toast = { id: nextId++, message };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => dismiss(toast.id), ms);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          <button aria-label="Cerrar aviso" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

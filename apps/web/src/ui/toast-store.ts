/** Store de avisos: cualquier parte de la app (incluso fuera de React) puede mostrar uno. */
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

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getToasts = () => toasts;

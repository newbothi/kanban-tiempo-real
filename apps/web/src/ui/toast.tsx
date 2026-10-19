import { useSyncExternalStore } from 'react';
import { dismiss, getToasts, subscribe } from './toast-store';

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getToasts);
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

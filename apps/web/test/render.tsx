import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import App from '../src/App';
import { createQueryClient } from '../src/api/queryClient';
import { Toaster } from '../src/ui/toast';

/** Renderiza con el mismo QueryClient de la app (sin reintentos, para que los tests sean rápidos). */
export function renderWithClient(ui: ReactNode) {
  const client = createQueryClient({ retry: 0 });
  const utils = render(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

export const renderApp = () => renderWithClient(<App />);

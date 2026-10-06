import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { ApiError, setUnauthorizedHandler } from './api/client'
import { setSessionUser } from './api/queries'
import { disconnectSocket } from './realtime/socket'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Toaster, showToast } from './ui/toast'

// Las mutaciones declaran su mensaje de error en `meta.errorMessage` (tipado aquí).
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { errorMessage?: string }
  }
}

/** Texto para el usuario a partir del error técnico. */
function describe(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 401) return null // ya se maneja volviendo al login
    if (error.status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo.'
    return error.message // p. ej. "Solo el dueño del tablero puede hacer esto"
  }
  return 'No hay conexión con el servidor.'
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1 },
  },
  // Un solo lugar para avisar de cualquier mutación fallida.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const title = mutation.meta?.errorMessage
      if (!title) return // esa mutación muestra su propio error (p. ej. el login)
      const detail = describe(error)
      if (detail) showToast(`${title}. ${detail}`)
    },
  }),
})

// Si cualquier request responde 401, la sesión venció: volvemos a la pantalla de login.
setUnauthorizedHandler(() => {
  disconnectSocket()
  setSessionUser(queryClient, null)
  showToast('Tu sesión expiró. Vuelve a iniciar sesión.')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

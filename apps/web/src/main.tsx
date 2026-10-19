import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { setUnauthorizedHandler } from './api/client'
import { createQueryClient } from './api/queryClient'
import { setSessionUser } from './api/queries'
import { disconnectSocket, socket } from './realtime/socket'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Toaster } from './ui/toast'
import { showToast } from './ui/toast-store'

const queryClient = createQueryClient()

// Si cualquier request responde 401, la sesión venció: volvemos a la pantalla de login.
const endSession = (message: string) => {
  disconnectSocket()
  setSessionUser(queryClient, null)
  showToast(message)
}
setUnauthorizedHandler(() => endSession('Tu sesión expiró. Vuelve a iniciar sesión.'))

// El servidor avisa cuando la sesión se cerró en otra pestaña o dispositivo (o venció).
socket.on('session:ended', () => endSession('Se cerró tu sesión. Vuelve a iniciar sesión.'))

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Falta el elemento #root en index.html')

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

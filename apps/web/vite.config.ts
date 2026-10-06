import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, /api se redirige a la API de Node: el front llama a rutas relativas.
    proxy: {
      '/api': 'http://localhost:3000',
      // WebSocket de Socket.IO
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
})

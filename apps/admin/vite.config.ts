import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  server: {
    port: 5173,
    proxy: {
      '/collections': 'http://localhost:3000',
      '/conformance': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
})

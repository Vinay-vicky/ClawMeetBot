import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/dashboard-ui',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/dashboard/api': 'http://localhost:3000',
      '/dashboard/auth': 'http://localhost:3000',
    },
  },
  base: '/dashboard/ui/',
})

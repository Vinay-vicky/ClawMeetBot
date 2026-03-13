import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const standalone = env.VITE_STANDALONE === 'true'

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
    },
    build: {
      outDir: standalone ? 'dist' : '../public/dashboard-ui',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/dashboard/api': 'http://localhost:3000',
        '/dashboard/auth': 'http://localhost:3000',
      },
    },
    base: standalone ? '/' : '/dashboard/ui/',
  }
})

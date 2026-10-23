import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        xfwd: true,
      },
      '/ip': {
        target: apiTarget,
        changeOrigin: true,
        xfwd: true,
        rewrite: () => '/api/ip',
      },
      '/all': {
        target: apiTarget,
        changeOrigin: true,
        xfwd: true,
        rewrite: () => '/api/all',
      },
      '^/$': {
        target: apiTarget,
        changeOrigin: true,
        xfwd: true,
        rewrite: () => '/api/ip',
        bypass: (req) =>
          /^(curl|wget|httpie|python-requests|powershell)/i.test(req.headers['user-agent'] || '')
            ? undefined
            : '/index.html',
      },
    },
  },
})

/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import phosphorWeights from './phosphor-weights.mjs'
import { fileURLToPath } from 'node:url'

// El frontend vive en client/ y se compila directo a ../public, que es la carpeta
// que NestJS sirve en producción (API + SPA en el mismo origen).
const clientRoot = fileURLToPath(new URL('.', import.meta.url))
const publicOut = fileURLToPath(new URL('../public', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: clientRoot,
  plugins: [react(), tailwindcss(), phosphorWeights()],
  build: {
    outDir: publicOut,
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Iconos antes que React: la ruta '@phosphor-icons/react/' también contiene '/react/'.
          if (id.includes('@phosphor-icons')) return 'icons'
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/'))
            return 'react-vendor'
          if (id.includes('axios')) return 'http'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    /**
     * Proxy de desarrollo → el navegador habla SIEMPRE con el mismo origen
     * (localhost:5173) y Vite reenvía al backend.
     *
     * Por qué hace falta: el `index.html` lleva una CSP estricta con
     * `connect-src 'self'`. Si el frontend llamara directamente a
     * `http://localhost:3000/api` (otro origen = otro puerto), el navegador
     * bloquearía la petición antes de enviarla y se vería como
     * "No se pudo conectar con el servidor".
     *
     * Con el proxy, desarrollo se comporta igual que producción (donde NestJS
     * sirve la SPA y la API en el mismo dominio), así que lo que funciona aquí
     * funciona allí — incluidas las fotos protegidas de /uploads.
     */
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_BACKEND || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_DEV_BACKEND || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
})

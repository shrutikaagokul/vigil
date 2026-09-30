import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the backend during development.
    // Set VITE_API_BASE_URL to point directly at a remote backend,
    // or leave it empty to use this proxy (→ localhost:8000).
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/simulate': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/rules': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/alerts': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/transactions': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/engine': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});

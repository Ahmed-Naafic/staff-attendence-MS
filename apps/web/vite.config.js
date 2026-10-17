import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Development: the web app calls /api on its own origin and Vite forwards it to the API, so the
  // session cookie stays first-party and no CORS is needed. Production serves both on one origin.
  // API_PROXY_TARGET overrides the API address (e.g. a second API on another port).
  server: {
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:4000' },
  },
  preview: {
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:4000' },
  },
});

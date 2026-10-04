// Dev: the Bun server on :4399 refuses foreign Host and Origin headers, so the proxy presents
// itself as the server's own origin. Build: output is served by server.mjs under /viz/.
import { defineConfig } from 'vite';

const server = 'http://127.0.0.1:4399';
export default defineConfig({
  base: '/viz/',
  server: {
    proxy: { '/api': { target: server, changeOrigin: true, headers: { origin: server } } }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});

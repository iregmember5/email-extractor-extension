import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
const callbackRoute: Plugin = {
  name: 'powerly-google-callback-route',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.split('?')[0] === '/sign-in')
        request.url = request.url.replace('/sign-in', '/sign-in.html');
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.split('?')[0] === '/sign-in')
        request.url = request.url.replace('/sign-in', '/sign-in.html');
      next();
    });
  },
};
export default defineConfig({
  root: resolve(import.meta.dirname, 'website-companion'),
  plugins: [react(), callbackRoute],
  base: '/',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: process.env.EXTENSION_AUTH_OUT_DIR || resolve(import.meta.dirname, 'dist-companion'),
    rollupOptions: {
      input: {
        'extension-auth': resolve(import.meta.dirname, 'website-companion/extension-auth.html'),
        callback: resolve(import.meta.dirname, 'website-companion/sign-in.html'),
      },
      output: {
        entryFileNames: 'extension-auth-assets/[name].js',
        chunkFileNames: 'extension-auth-assets/[name]-[hash].js',
        assetFileNames: 'extension-auth-assets/[name]-[hash][extname]',
      },
    },
  },
});

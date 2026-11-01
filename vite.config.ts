import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        panel: resolve(import.meta.dirname, 'index.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (entry) =>
          entry.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});

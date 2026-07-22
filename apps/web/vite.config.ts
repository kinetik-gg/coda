import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { javascriptChunkSizeGuard } from './src/chunk-size-guard';

export default defineConfig({
  plugins: [react(), javascriptChunkSizeGuard()],
  resolve: {
    alias: {
      '@coda/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          pdf: ['pdfjs-dist'],
          react: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-table'],
        },
      },
    },
  },
  test: {
    allowOnly: false,
    exclude: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/**/*.d.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});

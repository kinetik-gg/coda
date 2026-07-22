import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
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
    coverage: {
      provider: 'v8',
      include: [
        'src/{account-preferences,account-validation,api-activity,api,app-routing,keybindings,pdf-theme,project-list,sensitive-route-token,themes,workspace-controls}.ts',
        'src/admin/utils.ts',
        'src/project-management/{entity-utils,field-utils,import-utils}.ts',
        'src/project-setup/source-validation.ts',
        'src/workspace/{recipes,workspace-status}.ts',
        'src/workspace/layout/{close,geometry,join,reconstruct,reducer,validation}.ts',
        'src/workspace/panels/{entity-table-sizing,inspector-values,item-panel-utils}.{ts,tsx}',
        'src/workspace/panels/PdfPanelView.tsx',
        'src/components/{ConfirmationDialog,CustomSelect,Tooltip}.tsx',
        'src/workspace/shell/{PanelFrame,SplitTree,Splitter,WorkspaceShell}.tsx',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      thresholds: { statements: 80, lines: 80 },
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2021', sourcemap: false, chunkSizeWarningLimit: 1500,
    // second page: the separate Print / Save PDF window
    rollupOptions: { input: { main: 'index.html', print: 'print.html' } },
  },
});

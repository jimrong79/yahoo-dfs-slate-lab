import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {rollupOptions: {input: {
    builder: fileURLToPath(new URL('./index.html', import.meta.url)),
    results: fileURLToPath(new URL('./results.html', import.meta.url)),
  }}},
});

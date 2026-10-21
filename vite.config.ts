import { defineConfig } from 'vite-plus';

// The app is a plain SPA: it must work when it is served from the domain root
// (`http://localhost/`) as well as from any nested path
// (`http://localhost/my/web/app/path`). Relative asset URLs make that possible.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

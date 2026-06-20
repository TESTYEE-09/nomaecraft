import { defineConfig } from 'vite';

// GitHub Pages serves the site at https://<user>.github.io/<repo>/, so the
// bundle must be built with that base path. `vite preview` and local dev
// still work fine with it.
export default defineConfig({
  base: '/nomaecraft/',
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});

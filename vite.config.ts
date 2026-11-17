import { defineConfig } from 'vite';

// base './': every asset path is relative, so dist/ works at a domain root or under a subpath (GitHub Pages /fuse/).
export default defineConfig({
  base: './',
});

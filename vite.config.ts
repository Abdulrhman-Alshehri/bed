/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Content Security Policy for the production build: the page may only load and connect to its
// own origin, so neither the document image nor extracted data can be sent anywhere else, even by
// a bug or a compromised dependency. ('wasm-unsafe-eval' allows WebAssembly compilation only.)
// Not applied to the dev server, whose hot-reload client needs inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// A relative base ('./') makes the build work under any GitHub Pages subpath
// (https://<user>.github.io/<repo>/), on a custom domain, and with `vite preview`.
// Override with VITE_BASE=/some/path/ if an absolute base is ever required.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // React + libphonenumber metadata; the OCR code is split into chunks loaded on first use.
    chunkSizeWarningLimit: 600,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

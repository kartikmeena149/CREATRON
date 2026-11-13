// The website: a landing page and the editor's browser demo (demo/), built to plain static files.
// npm run site:dev to work on it, npm run site:build to make website/dist for any static host.
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;

export default defineConfig({
  root: here,
  // Relative links, so the built site works at a domain's root or in a subfolder.
  base: "./",
  plugins: [react()],
  // The demo is the app's own code, one folder up.
  server: { fs: { allow: [resolve(here, "..")] } },
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(here, "index.html"), demo: resolve(here, "demo/index.html"), login: resolve(here, "login/index.html"), brand: resolve(here, "brand/index.html"), notFound: resolve(here, "404.html") } },
  },
});

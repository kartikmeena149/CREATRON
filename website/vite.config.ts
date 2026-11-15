// The website: the landing page, sign-in and the games, built to plain static files. The editor's
// browser demo (demo/) and the brand page (brand/) are kept in the source but not built or deployed.
// npm run site:dev to work on it, npm run site:build to make website/dist for any static host.
import react from "@vitejs/plugin-react";
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;

// Only the logo files the pages use are published; the rest of public/brand (full logos, wordmarks,
// icon sizes) stays in the source for the team and the app.
const PUBLIC_BRAND = new Set(["favicon.svg", "app-icon-180.png", "mark.svg", "mark-white.svg", "mark-small-white.svg"]);
const brandFilesOnlyAsUsed = {
  name: "brand-files-only-as-used",
  closeBundle() {
    const dir = resolve(here, "dist", "brand");
    for (const f of readdirSync(dir)) if (!PUBLIC_BRAND.has(f)) rmSync(resolve(dir, f), { recursive: true });
    // The demo's sample clip goes with the demo: nothing published uses it before launch.
    rmSync(resolve(here, "dist", "sample"), { recursive: true, force: true });
  },
};

export default defineConfig({
  root: here,
  // Relative links, so the built site works at a domain's root or in a subfolder.
  base: "./",
  plugins: [react(), brandFilesOnlyAsUsed],
  // The demo is the app's own code, one folder up.
  server: { fs: { allow: [resolve(here, "..")] } },
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(here, "index.html"), login: resolve(here, "login/index.html"), play: resolve(here, "play/index.html"), notFound: resolve(here, "404.html") } },
  },
});

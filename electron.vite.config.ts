import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, "electron/main.ts") },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "electron/preload.ts"),
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "app"),
    build: { rollupOptions: { input: resolve(import.meta.dirname, "app/index.html") } },
    plugins: [react()],
  },
});

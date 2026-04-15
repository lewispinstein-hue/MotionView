import { defineConfig } from "vite";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = 1420;

export default defineConfig({
  root: resolve(__dirname, "src"),
  base: "./",
  publicDir: false,
  server: {
    host,
    port,
    strictPort: true,
  },
  preview: {
    host,
    port,
    strictPort: true,
  },
  build: {
    target: "esnext",
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
      },
    },
  },
});

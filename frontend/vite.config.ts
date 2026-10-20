import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // changeOrigin rewrites the Host header, so Django accepts requests from other devices
    // on the network (for example a phone opening the dev server's network address).
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // MapLibre GL is about 1 MB minified (under 300 kB gzipped) and is loaded lazily as its own chunk.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/vite-env.d.ts"],
    },
  },
});

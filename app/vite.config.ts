import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pre-bundle the viewport deps up front so the first dev load is not interrupted by
  // Vite's dependency re-optimisation reload (it killed the bake worker on a cold start).
  optimizeDeps: {
    include: ["three", "camera-controls", "react", "react-dom", "react-dom/client"],
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API and WS requests to the Deno server
      "/api": {
        target: "http://127.0.0.1:7317",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:7317",
        ws: true,
        changeOrigin: true,
      },
      "/files": {
        target: "http://127.0.0.1:7317",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
});

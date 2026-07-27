import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Tauri expects the dev server on a fixed port (matches tauri.conf.json devUrl).
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "esnext" },
});

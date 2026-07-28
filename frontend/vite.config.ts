import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    // Proxy API calls to the backend service on the compose network.
    proxy: { "/api": "http://backend:8080" },
  },
  // Production: `vite preview` sits behind Caddy, which forwards the public domain as
  // the Host header. Accept it (the preview server is only reachable via Caddy on the
  // internal network, never published to the host). Caddy routes /api/* to the backend.
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

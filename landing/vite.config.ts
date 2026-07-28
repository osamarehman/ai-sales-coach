import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

// Served under /join on the app domain (https://sales-coach.shipdeck.dev/join) via the shared
// Caddy edge → the `sc-landing` container. The API lives on the same origin, so the form POSTs
// to /api/waitlist first-party (no CORS). To move this to its own subdomain root instead, set
// `base: "/"` and rebuild (then add a DNS A record for the box + a Caddy drop-in).
export default defineConfig({
  base: "/join/",
  plugins: [solid(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    // Dev only: proxy API calls to the backend service on the compose network.
    proxy: { "/api": "http://backend:8080" },
  },
  // Prod: `vite preview` sits behind Caddy, which forwards the public Host header. Accept it —
  // the preview server is only reachable via Caddy on the internal `web` network.
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

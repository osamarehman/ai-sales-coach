import posthog from "posthog-js";

// Desktop overlay observability (PostHog). Env-gated: inert without VITE_POSTHOG_KEY (baked into the
// bundle at build time by CI / the desktop build). Deliberately minimal for a Tauri webview:
//  - capture JS errors (the point), but
//  - disable_external_dependency_loading so PostHog NEVER injects a <script>/<style> from its CDN —
//    the strict app CSP (tauri.conf.json) then only needs connect-src for ingestion, and
//  - no session replay / autocapture / pageviews / web-vitals in a 380×260 always-on-top overlay.
const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

let started = false;

/** Boot PostHog once, before the first render. No-op when unconfigured. */
export function initTelemetry(): void {
  if (started || !KEY) return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: "identified_only",
    // The point: uncaught JS errors + unhandled promise rejections → $exception events.
    capture_exceptions: true,
    // An overlay isn't a browsing surface — skip pageviews / autocapture / replay / perf.
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    capture_performance: false,
    // Strict Tauri CSP: never fetch extra JS/CSS from the PostHog CDN (exception capture is bundled).
    disable_external_dependency_loading: true,
  });
}

/** Tie desktop events to the signed-in user, mirroring the server-side capture. No-op when off. */
export function identifyUser(userId: string, props?: Record<string, unknown>): void {
  if (started) posthog.identify(userId, props);
}

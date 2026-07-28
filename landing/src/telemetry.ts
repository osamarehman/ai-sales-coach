import posthog from "posthog-js";

// Client-side observability for the public waitlist page. Env-gated: inert without VITE_POSTHOG_KEY,
// so unconfigured builds are unchanged. Project token (phc_…) is client-safe. Mirrors app + server.
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
    // Capture uncaught JS errors + unhandled promise rejections on the public page.
    capture_exceptions: true,
    capture_performance: { web_vitals: true },
    capture_pageview: true,
    // No session replay on the public page.
    disable_session_recording: true,
  });
}

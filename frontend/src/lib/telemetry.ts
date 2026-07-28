import posthog from "posthog-js";

// Client-side observability (PostHog RUM). Env-gated: with no VITE_POSTHOG_KEY the whole module is
// inert, so unconfigured / older builds behave exactly as before. The project token (phc_…) is
// client-safe by design; this mirrors the server-side capture in backend/ + realtime/.
const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

let started = false;

/** Boot PostHog once, before the first render. No-op when unconfigured. */
export function initTelemetry(): void {
  if (started || !KEY) return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    // Only materialise a person profile once a user logs in — anonymous RUM stays cheap + private.
    person_profiles: "identified_only",
    // The core ask: uncaught JS errors + unhandled promise rejections → $exception events.
    capture_exceptions: true,
    // Real-user performance (LCP / CLS / INP / FCP).
    capture_performance: { web_vitals: true },
    // SPA: capture a pageview on each client-side route change (@solidjs/router).
    capture_pageview: "history_change",
    // Sensitive product (sales-call data): no session replay unless deliberately enabled later.
    disable_session_recording: true,
  });
}

/** Tie client events to the signed-in user so a browser error lines up with the server-side
 *  capture (which tags req.auth.userId / tenantId). Safe no-op when telemetry is off. */
export function identifyUser(user: { id: string; email: string; role: string }, tenantId?: string): void {
  if (!started) return;
  posthog.identify(user.id, { email: user.email, role: user.role, tenantId });
}

/** Clear identity on logout so the next user on this browser isn't merged into the previous one. */
export function resetTelemetry(): void {
  if (started) posthog.reset();
}

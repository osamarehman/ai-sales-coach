import { PostHog } from "posthog-node";

// Server-side error capture → PostHog for the realtime WS service. Env-gated: with no POSTHOG_KEY
// every function here is a no-op, so the service behaves identically whether or not telemetry is
// configured. POSTHOG_KEY is the project key (phc_…) — client-safe, but sourced from env, never inline.
const apiKey = process.env.POSTHOG_KEY ?? "";
const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

const client = apiKey ? new PostHog(apiKey, { host }) : null;

export const telemetryEnabled = client !== null;

// Stamped on every captured error so realtime vs backend and env are filterable in PostHog.
const base = { service: "realtime", env: process.env.NODE_ENV ?? "development" };

/**
 * Capture a realtime-service exception. `context` becomes event properties (where, sessionId,
 * tenantId, …) so error spikes can be sliced in PostHog; pass `distinctId` to attribute it to a
 * user. Never throws — a telemetry failure must never break a live session.
 */
export function captureException(err: unknown, context: Record<string, unknown> = {}): void {
  if (!client) return;
  try {
    const error = err instanceof Error ? err : new Error(String(err));
    const { distinctId, ...props } = context as { distinctId?: string } & Record<string, unknown>;
    client.captureException(error, typeof distinctId === "string" ? distinctId : "realtime", {
      ...base,
      ...props,
    });
  } catch {
    /* swallow — telemetry is best-effort and must not affect the live path */
  }
}

/** Best-effort flush so a redeploy/crash doesn't drop the last batch of buffered errors. */
export async function flushTelemetry(): Promise<void> {
  if (!client) return;
  try {
    await client.flush();
  } catch {
    /* ignore */
  }
}

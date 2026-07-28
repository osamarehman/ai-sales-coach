// Central env config. Read once; fail fast only for vars a given path truly needs
// (health checks must work even without an OpenRouter key configured).
// Frontend origin (cookies/redirects) and the public API origin (webhook URLs).
const appUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:5183";
const publicApiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:8090";

export const config = {
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5",
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  },
  appUrl,
  publicApiUrl,
  // Origins allowed to drive authenticated requests (BetterAuth CSRF origin check).
  trustedOrigins: [appUrl, publicApiUrl].concat(
    (process.env.PUBLIC_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
  realtime: {
    // Secret to sign the short-lived token the desktop/phone client redeems on the
    // realtime WS. Dedicated var preferred; falls back to the auth secret for a
    // single-secret dev setup. The isolated `realtime` service verifies with the same value.
    tokenSecret: process.env.REALTIME_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET || "",
    // Public WS URL handed to the client (dev: loopback; prod: wss via the shared edge).
    wsUrl: process.env.PUBLIC_REALTIME_URL ?? "ws://localhost:8091",
  },
};

export function requireOpenRouterKey(): string {
  if (!config.openRouter.apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set — add it to .env to run analyses.");
  }
  return config.openRouter.apiKey;
}

export function requireRealtimeSecret(): string {
  if (!config.realtime.tokenSecret) {
    throw new Error(
      "REALTIME_TOKEN_SECRET (or BETTER_AUTH_SECRET) is not set — cannot mint realtime session tokens.",
    );
  }
  return config.realtime.tokenSecret;
}

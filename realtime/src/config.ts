// Central env for the isolated realtime service. Fail fast only for what boot needs.
const port = Number(process.env.PORT ?? 8081);

// The realtime WS authenticates a per-session token minted by the main backend
// (POST /api/realtime/token). Both sides sign/verify with this shared secret. A
// dedicated REALTIME_TOKEN_SECRET is preferred; it falls back to BETTER_AUTH_SECRET
// so a single-secret dev setup still works.
const tokenSecret = process.env.REALTIME_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET || "";

// The live cue engine (RT-3) calls Anthropic directly (Haiku 4.5) for structured cue
// inference — a deliberate split from the async grader's OpenRouter/Sonnet path. Optional:
// with no key the engine stays disabled and the WS still runs RT-0 (handshake + consent +
// session lifecycle) unchanged. Model is overridable so we can pin/upgrade without a redeploy.
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || "";
const cueModel = process.env.REALTIME_CUE_MODEL || "claude-haiku-4-5-20251001";

export const config = { port, tokenSecret, anthropicApiKey, cueModel };

export function requireTokenSecret(): string {
  if (!tokenSecret) {
    throw new Error(
      "REALTIME_TOKEN_SECRET (or BETTER_AUTH_SECRET) is not set — the realtime service cannot verify session tokens.",
    );
  }
  return tokenSecret;
}

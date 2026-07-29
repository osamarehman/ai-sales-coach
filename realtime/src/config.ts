// Central env for the isolated realtime service. Fail fast only for what boot needs.
const port = Number(process.env.PORT ?? 8081);

// The realtime WS authenticates a per-session token minted by the main backend
// (POST /api/realtime/token). Both sides sign/verify with this shared secret. A
// dedicated REALTIME_TOKEN_SECRET is preferred; it falls back to BETTER_AUTH_SECRET
// so a single-secret dev setup still works.
const tokenSecret = process.env.REALTIME_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET || "";

// The live cue engine (RT-3) picks WHICH coaching cue fires via a forced-tool LLM call. Inference
// runs through OpenRouter by default so we can A/B cheap/fast models (gpt-4o-mini, haiku, or an
// open-source model) just by swapping REALTIME_CUE_MODEL — no logic redeploy. Set REALTIME_CUE_PROVIDER
// to "anthropic" to call Anthropic directly instead. Optional: with no key for the SELECTED provider
// the engine stays disabled and the WS still runs RT-0 (handshake + consent + session lifecycle).
const cueProvider = (process.env.REALTIME_CUE_PROVIDER || "openrouter").toLowerCase();
const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || "";
// Default model tracks the provider (an OpenRouter slug vs an Anthropic model id); override to A/B.
const cueModel =
  process.env.REALTIME_CUE_MODEL || (cueProvider === "anthropic" ? "claude-haiku-4-5-20251001" : "openai/gpt-4o-mini");

// RT-2 STT relay: ElevenLabs Scribe v2 Realtime (WebSocket). Optional — with no key the relay
// stays off and the WS runs RT-0 (+ the cue engine, key permitting) unchanged. The env var is
// ELEVENLABS_API (NOT _KEY). Model is overridable so we can pin/upgrade without a redeploy.
const elevenLabsApiKey = process.env.ELEVENLABS_API || "";
const scribeModel = process.env.SCRIBE_MODEL || "scribe_v2_realtime";

export const config = { port, tokenSecret, cueProvider, openRouterApiKey, anthropicApiKey, cueModel, elevenLabsApiKey, scribeModel };

export function requireTokenSecret(): string {
  if (!tokenSecret) {
    throw new Error(
      "REALTIME_TOKEN_SECRET (or BETTER_AUTH_SECRET) is not set — the realtime service cannot verify session tokens.",
    );
  }
  return tokenSecret;
}

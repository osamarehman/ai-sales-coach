import { z } from "zod";

// Pure, DB-free protocol logic for the realtime WS — the server side of
// desktop/PROTOCOL.md (v0). Kept import-free of ./db so it unit-tests without a pool.

// ---- per-connection state -------------------------------------------------

export type Phase = "greeting" | "ready" | "consented" | "closed";

export interface ConnState {
  phase: Phase;
  sessionId: string | null;
  tenantId: string | null;
  userId: string | null;
  framesAccepted: number;
  framesDropped: number;
  preConsentErrorSent: boolean; // tell the client once, then silently drop
}

export function initConn(): ConnState {
  return {
    phase: "greeting",
    sessionId: null,
    tenantId: null,
    userId: null,
    framesAccepted: 0,
    framesDropped: 0,
    preConsentErrorSent: false,
  };
}

/** The consent gate: audio is processed ONLY after consent has been captured. */
export function audioAdmitted(phase: Phase): boolean {
  return phase === "consented";
}

// ---- client -> server control messages (text frames) ----------------------

const Hello = z.object({
  type: z.literal("hello"),
  session_token: z.string().min(1),
  app_version: z.string().max(64).optional(),
  platform: z.enum(["linux", "macos", "windows"]).optional(),
  sample_rate: z.number().int().positive().max(192_000).optional(),
  frame_samples: z.number().int().positive().max(100_000).optional(),
});

const Consent = z.object({
  type: z.literal("consent"),
  captured: z.boolean(),
  method: z.enum(["spoken", "checkbox"]).optional(),
  ts_ms: z.number().int().nonnegative().optional(),
});

const Bye = z.object({
  type: z.literal("bye"),
  reason: z.string().max(200).optional(),
});

export const ControlMessage = z.discriminatedUnion("type", [Hello, Consent, Bye]);
export type ControlMessage = z.infer<typeof ControlMessage>;

/** Parse a text control frame. Throws on invalid JSON or an unknown/invalid shape. */
export function parseControl(raw: string): ControlMessage {
  return ControlMessage.parse(JSON.parse(raw));
}

// ---- client -> server audio frame (binary frame) --------------------------
// Layout (little-endian): [0]=channel u8, [1..9)=ts_ms u64, [9..)=PCM16 mono i16[].

export interface AudioFrameMeta {
  channel: 0 | 1; // 0 = rep mic, 1 = prospect system
  tsMs: number;
  sampleCount: number;
}

export function parseAudioFrame(buf: Uint8Array): AudioFrameMeta {
  if (buf.byteLength < 9) throw new Error("audio frame too short");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const channel = view.getUint8(0);
  if (channel !== 0 && channel !== 1) throw new Error(`bad channel ${channel}`);
  const tsMs = Number(view.getBigUint64(1, true));
  const payloadBytes = buf.byteLength - 9;
  if (payloadBytes % 2 !== 0) throw new Error("PCM16 payload must be an even byte length");
  return { channel, tsMs, sampleCount: payloadBytes / 2 };
}

// ---- server -> client messages (text frames) ------------------------------

export type ErrorCode = "consent_required" | "bad_message" | "internal";
export type CueTier = "crit" | "help" | "fyi";

export const msg = {
  ready: (sessionId: string) => JSON.stringify({ type: "ready", session_id: sessionId }),
  error: (code: ErrorCode, message: string) => JSON.stringify({ type: "error", code, message }),
  // A coaching cue for the overlay (desktop/PROTOCOL.md §Server→Client). `text` is the
  // authored, de-branded nudge (never LLM free-text); `id` lets the client de-dupe/ack.
  cue: (c: { id: string; tier: CueTier; text: string; category: string | null; ttlMs: number; tsMs: number }) =>
    JSON.stringify({ type: "cue", id: c.id, tier: c.tier, text: c.text, ttl_ms: c.ttlMs, category: c.category, ts_ms: c.tsMs }),
  // NOTE: the observability `transcript` frame (desktop/PROTOCOL.md §Server→Client) ships with RT-2,
  // the slice that actually produces merged transcript segments — no builder until there's a producer.
};

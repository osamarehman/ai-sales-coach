// RT-2: streaming STT relay. Turns the two live audio channels (rep mic = channel 0,
// prospect system = channel 1) into speaker-tagged, call-clock TranscriptSegments and hands
// each FINAL segment to the cue engine via CueRuntime.feedTranscript().
//
// Provider = ElevenLabs Scribe v2 Realtime (WebSocket STT). One session PER channel, so the
// speaker is known BY CONSTRUCTION — we never rely on model diarization (which is batch-only).
// Scribe transcribes; deciding WHICH cue to fire stays a separate step (cue-engine.ts).
//
// Boundary discipline (see .claude/skills/realtime-llm-output-boundary): Scribe output is
// UNTRUSTED — every field is type-checked/coerced here and a malformed message is ignored,
// never thrown, so one bad frame can't kill the session.
import type { Speaker, TranscriptSegment } from "./transcript";

const SCRIBE_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const DEFAULT_MODEL = "scribe_v2_realtime";
// The wire rate is FIXED at 16 kHz by the capture core (bridge WIRE_RATE; dsp resamples to 16k), so
// this relay is 16 kHz-only and the Scribe audio_format is a constant pcm_16000 (see buildScribeUrl).

// Reconnect: a dropped Scribe socket = no more coaching for the rest of the call, so we retry
// with capped backoff. Audio that arrives while disconnected is DROPPED (not buffered) — stale
// audio replayed after a gap would be misaligned and unbounded.
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

// ---- pure: parse a Scribe message -----------------------------------------

export type ScribeEvent =
  | { kind: "ready"; sessionId: string | null }
  | { kind: "partial"; text: string }
  | { kind: "segment"; text: string; startSec: number | null; endSec: number | null }
  | { kind: "ignore" };

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Audio-relative span (seconds) of the real WORDS in a timestamped transcript. Spacing /
// audio_event entries are skipped; missing/garbled timings collapse to null (the caller then
// falls back to the last audio timestamp for duration).
function wordSpan(words: unknown): { startSec: number | null; endSec: number | null } {
  if (!Array.isArray(words)) return { startSec: null, endSec: null };
  let startSec: number | null = null;
  let endSec: number | null = null;
  for (const raw of words) {
    const w = asObject(raw);
    if (!w) continue;
    if (typeof w.type === "string" && w.type !== "word") continue; // skip spacing / audio_event
    const s = Number(w.start);
    const e = Number(w.end);
    if (Number.isFinite(s)) startSec = startSec === null ? s : Math.min(startSec, s);
    if (Number.isFinite(e)) endSec = endSec === null ? e : Math.max(endSec, e);
  }
  return { startSec, endSec };
}

// With commit_strategy=vad + include_timestamps we normally get *_with_timestamps; the plain
// variants are handled too (degraded: no word span => zero-length duration).
const FINAL_TYPES = new Set([
  "committed_transcript_with_timestamps",
  "final_transcript_with_timestamps",
  "committed_transcript",
  "final_transcript",
]);

export function parseScribeMessage(raw: string): ScribeEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "ignore" };
  }
  const m = asObject(parsed);
  if (!m) return { kind: "ignore" };
  const type = asString(m.message_type);
  if (type === "session_started") {
    return { kind: "ready", sessionId: typeof m.session_id === "string" ? m.session_id : null };
  }
  if (type === "partial_transcript") {
    return { kind: "partial", text: asString(m.text) };
  }
  if (FINAL_TYPES.has(type)) {
    const { startSec, endSec } = wordSpan(m.words);
    return { kind: "segment", text: asString(m.text), startSec, endSec };
  }
  return { kind: "ignore" };
}

// ---- pure: map a final event to a call-clock segment ----------------------

// endMs is anchored to the latest audio timestamp forwarded on this channel (the call clock),
// so it never drifts even if the client gates silence; the utterance DURATION comes from
// Scribe's word span. Returns a FINAL segment ready for TranscriptBuffer / feedTranscript.
export function toTranscriptSegment(
  ev: { text: string; startSec: number | null; endSec: number | null },
  ctx: { speaker: Speaker; lastTsMs: number },
): TranscriptSegment | null {
  const text = ev.text.trim();
  if (!text) return null;
  // parseScribeMessage only ever yields finite-or-null spans, but this is a public boundary — guard
  // against a non-finite span/anchor so a bad caller can't produce NaN timestamps downstream.
  const durMs =
    isFiniteNum(ev.startSec) && isFiniteNum(ev.endSec) ? Math.max(0, Math.round((ev.endSec - ev.startSec) * 1000)) : 0;
  const endMs = Math.max(0, isFiniteNum(ctx.lastTsMs) ? ctx.lastTsMs : 0);
  const startMs = Math.max(0, endMs - durMs);
  return { speaker: ctx.speaker, text, startMs, endMs, final: true };
}

function isFiniteNum(n: number | null): n is number {
  return n !== null && Number.isFinite(n);
}

// ---- socket glue ----------------------------------------------------------

export interface SttSocket {
  send(data: string): void;
  close(): void;
}
export interface SocketHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onClose: () => void;
  onError: (err: unknown) => void;
}
// Injectable so tests drive a fake socket (no network). Prod uses Bun's WebSocket client.
export type SocketFactory = (url: string, apiKey: string, handlers: SocketHandlers) => SttSocket;

export function buildScribeUrl(model: string): string {
  const q = new URLSearchParams({
    model_id: model,
    audio_format: "pcm_16000",
    commit_strategy: "vad", // Scribe segments on silence => one committed message per utterance
    include_timestamps: "true",
    include_language_detection: "true", // owner decision: auto-detect language
    enable_logging: "false", // zero-retention: ElevenLabs does not retain the call audio
  });
  return `${SCRIBE_WS_URL}?${q.toString()}`;
}

const defaultSocketFactory: SocketFactory = (url, apiKey, h) => {
  // Bun's WebSocket client accepts a `headers` option (non-standard; absent from the DOM lib
  // types) — the clean way to pass server-side auth without a query token. Server-to-server only.
  const BunWebSocket = WebSocket as unknown as {
    new (url: string, options: { headers: Record<string, string> }): WebSocket;
  };
  const ws = new BunWebSocket(url, { headers: { "xi-api-key": apiKey } });
  ws.addEventListener("open", () => h.onOpen());
  ws.addEventListener("message", (e) => {
    const data = (e as { data?: unknown }).data;
    h.onMessage(typeof data === "string" ? data : "");
  });
  ws.addEventListener("close", () => h.onClose());
  ws.addEventListener("error", (e) => h.onError(e));
  return { send: (d) => ws.send(d), close: () => ws.close() };
};

interface ScribeSession {
  sendPcm(pcm: Uint8Array, tsMs: number): void;
  close(): void;
}

function connectScribe(opts: {
  channel: 0 | 1;
  apiKey: string;
  model: string;
  onSegment: (seg: TranscriptSegment) => void;
  factory: SocketFactory;
}): ScribeSession {
  const speaker: Speaker = opts.channel === 0 ? "rep" : "prospect";
  const url = buildScribeUrl(opts.model);
  let sock: SttSocket | null = null;
  let open = false;
  let closed = false;
  let lastTsMs = 0;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    if (closed) return;
    let handled = false; // a socket can emit close/error more than once — act on the first only
    sock = opts.factory(url, opts.apiKey, {
      onOpen: () => {
        open = true;
        attempts = 0; // a clean connection resets the backoff
      },
      onMessage: (data) => {
        const ev = parseScribeMessage(data);
        if (ev.kind !== "segment") return; // ready / partial / ignore don't feed the engine
        const seg = toTranscriptSegment(ev, { speaker, lastTsMs });
        if (seg) opts.onSegment(seg);
      },
      onClose: () => {
        if (handled) return; // a double close would schedule two reconnects => an orphaned socket
        handled = true;
        open = false;
        sock = null;
        scheduleReconnect();
      },
      onError: () => {
        /* a close event follows; reconnect is handled there */
      },
    });
  }

  function scheduleReconnect(): void {
    if (closed) return; // deliberate close() => never reconnect
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[realtime] scribe ch${opts.channel} gave up reconnecting after ${attempts} attempts`);
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    attempts++;
    reconnectTimer = setTimeout(connect, delay);
  }

  connect();

  return {
    sendPcm(pcm, tsMs) {
      if (closed) return;
      lastTsMs = tsMs; // advance the call clock even on a dropped/empty frame (keeps endMs anchored)
      if (pcm.length === 0) return; // keepalive / empty payload — nothing to transcribe
      if (!open || !sock) return; // dropped while (re)connecting — bounded, no stale replay
      // audio_format=pcm_16000 in the URL is the single source of the rate; no per-chunk sample_rate.
      sock.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: Buffer.from(pcm).toString("base64"),
        }),
      );
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        sock?.close();
      } catch {
        /* already gone */
      }
      sock = null;
    },
  };
}

// ---- per-session manager (up to 2 channels) -------------------------------

export interface SttManager {
  feed(channel: 0 | 1, pcm: Uint8Array, tsMs: number): void;
  close(): void;
}

// Opens a Scribe session lazily on the first frame of each channel (so mobile mic-only clients
// never open a prospect session). Each channel's FINAL segments flow to onSegment.
export function startStt(opts: {
  apiKey: string;
  model?: string;
  onSegment: (seg: TranscriptSegment) => void | Promise<void>;
  factory?: SocketFactory;
}): SttManager {
  const model = opts.model || DEFAULT_MODEL;
  const factory = opts.factory ?? defaultSocketFactory;
  const sessions = new Map<0 | 1, ScribeSession>();
  return {
    feed(channel, pcm, tsMs) {
      let session = sessions.get(channel);
      if (!session) {
        session = connectScribe({
          channel,
          apiKey: opts.apiKey,
          model,
          onSegment: (seg) => void opts.onSegment(seg),
          factory,
        });
        sessions.set(channel, session);
      }
      session.sendPcm(pcm, tsMs);
    },
    close() {
      for (const s of sessions.values()) s.close();
      sessions.clear();
    },
  };
}

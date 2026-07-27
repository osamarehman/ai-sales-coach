# Desktop ⇄ Realtime WebSocket Protocol (v0)

**This file is the contract between two lanes that build in parallel:**
- the **desktop app** (`desktop/`, this repo) — the client, and
- the **`realtime` backend service** (the other agent's lane) — the server.

Neither lane shares code with the other. Both build to *this document*. The desktop
develops against `desktop/dev-stub/` (a stand-in server that implements this protocol);
the real backend implements the same server side. They meet at integration.

Version this doc. Breaking changes bump `v0 → v1` and both `hello.protocol` values.

---

## Transport

- One **WebSocket** per live session. Client connects to the realtime service and
  authenticates via a per-session token (issued by the main backend; out of scope here).
- **Text frames** carry JSON control messages (below).
- **Binary frames** carry audio (below). This split keeps audio off the JSON path.
- The server **MUST reject / discard all audio until consent is captured** (see Consent gate).

## Handshake

1. Client opens the socket and sends `hello` (text).
2. Server replies `ready` (text) with a `session_id`, or `error` and closes.
3. Client sends `consent` (text) once the rep confirms the all-party disclosure.
4. Only after `consent.captured === true` may the client send **audio** frames, and only
   then does the server process them. Audio before consent is a protocol violation → the
   server SHOULD reply `error { code: "consent_required" }` and drop the frames.
5. Server streams `cue` / `transcript` (text) back at any time after `ready`.
6. Either side may send `bye` then close.

---

## Client → Server

### Text (control)

```jsonc
// hello — first message
{ "type": "hello",
  "session_token": "<opaque>",
  "app_version": "0.1.0",
  "platform": "linux" | "macos" | "windows" | "android" | "ios",
  "sample_rate": 16000,       // Hz of the PCM the client will send
  "frame_samples": 320 }      // samples per audio frame per channel (320 = 20ms @16k)
  // NOTE: android/ios are mic-only (channel 0). The OS forbids capturing the far end of a
  //       call, so mobile clients never send channel 1 (system/prospect).

// consent — gates audio processing server-side
{ "type": "consent",
  "captured": true,
  "method": "spoken" | "checkbox",
  "ts_ms": 0 }                // ms since session start

// bye
{ "type": "bye", "reason": "user_stopped" }
```

### Binary (audio frame)

Little-endian, one frame = one channel's chunk:

```
byte offset   size   field
0             1      channel      u8   (0 = mic / rep, 1 = system / prospect)
1             8      ts_ms        u64  (ms since session start, capture clock)
9             ...    samples      i16[] PCM16 mono @ hello.sample_rate
```

Mic and system are **separate frames on the same socket** — never mixed. Separate
channels give free speaker separation (rep = mic, prospect = system).

---

## Server → Client (text)

```jsonc
// ready — handshake ack
{ "type": "ready", "session_id": "<uuid>" }

// cue — a coaching cue to render on the overlay
{ "type": "cue",
  "id": "<uuid>",
  "tier": "crit" | "help" | "fyi",
  "text": "You're at 68% talk time — ask an open question.",
  "ttl_ms": 7000,             // auto-dismiss after this
  "category": "talk_ratio",   // free-form tag from the cue framework
  "ts_ms": 12345 }

// transcript — debug/observability stream (optional to render)
{ "type": "transcript",
  "speaker": "rep" | "prospect",
  "text": "...",
  "ts_ms": 12000,
  "final": true }

// error
{ "type": "error", "code": "consent_required" | "bad_message" | "internal",
  "message": "human readable" }
```

---

## Invariants both lanes must honor

1. `channel` 0 = rep mic, 1 = prospect system. Never mixed.
2. No audio is processed before `consent.captured === true`.
3. All PCM is **mono i16 at `hello.sample_rate`** (default 16 kHz). The client resamples
   before sending; the server never has to.
4. Unknown message `type` → `error { code: "bad_message" }`, do not close.
5. The Rust type mirror of this doc lives in `desktop/crates/ws-protocol` — if you change
   one, change the other in the same commit.

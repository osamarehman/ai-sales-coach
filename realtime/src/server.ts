import type { ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { config } from "./config";
import { verifyRealtimeToken } from "./lib/token";
import { initConn, parseControl, parseAudioFrame, audioAdmitted, msg, type ConnState } from "./protocol";
import { createLiveSession, markConsent, closeLiveSession } from "./sessions";
import { loadPlaybook } from "./framework";
import { anthropicCompleter } from "./cue-engine";
import { CueRuntime } from "./cue-runtime";
import { insertLiveCue } from "./cues";
import { captureException } from "./lib/telemetry";

interface Data {
  conn: ConnState;
  runtime?: CueRuntime; // the live cue engine (RT-3), armed after consent when a key is configured
}
type WS = ServerWebSocket<Data>;

export function startServer(port: number) {
  const server = Bun.serve<Data>({
    port,
    idleTimeout: 120, // seconds; drop a socket that goes silent (e.g. connects but never hellos)
    fetch(req, srv) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") return healthResponse();
      // The client authenticates in-band via the `hello` message, so any upgrade is allowed;
      // nothing is processed until a valid token + consent arrive.
      if (srv.upgrade(req, { data: { conn: initConn() } })) return; // 101 Switching Protocols
      return new Response("expected a websocket upgrade", { status: 426 });
    },
    websocket: {
      maxPayloadLength: 1 << 16, // 64 KiB — real audio frames are < 1 KiB
      async message(ws, raw) {
        try {
          if (typeof raw === "string") await onControl(ws, raw);
          else await onAudio(ws, raw as Uint8Array);
        } catch (err) {
          console.error("[realtime] handler error", err);
          captureException(err, {
            where: "ws_message",
            phase: ws.data.conn.phase,
            distinctId: ws.data.conn.userId,
            sessionId: ws.data.conn.sessionId,
            tenantId: ws.data.conn.tenantId,
          });
          try {
            ws.send(msg.error("internal", "internal error"));
          } catch {
            /* socket may be gone */
          }
        }
      },
      close(ws) {
        void onClose(ws);
      },
    },
  });
  console.log(`[realtime] listening on :${port}`);
  return server;
}

async function healthResponse(): Promise<Response> {
  try {
    await pool.query("select 1");
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}

async function onControl(ws: WS, raw: string) {
  const st = ws.data.conn;
  if (st.phase === "closed") return;

  let control;
  try {
    control = parseControl(raw);
  } catch {
    ws.send(msg.error("bad_message", "unparseable or unknown control message"));
    return; // invariant: an unknown message does NOT close the socket
  }

  switch (control.type) {
    case "hello": {
      if (st.phase !== "greeting") {
        ws.send(msg.error("bad_message", "hello already received"));
        return;
      }
      let claims;
      try {
        claims = verifyRealtimeToken(control.session_token, config.tokenSecret);
      } catch {
        ws.send(msg.error("bad_message", "invalid or expired session token"));
        ws.close(1008, "unauthorized");
        return;
      }
      const sessionId = await createLiveSession({
        tenantId: claims.tid,
        userId: claims.uid,
        platform: control.platform,
        appVersion: control.app_version,
        sampleRate: control.sample_rate,
      });
      st.phase = "ready";
      st.sessionId = sessionId;
      st.tenantId = claims.tid;
      st.userId = claims.uid;
      ws.send(msg.ready(sessionId));
      return;
    }

    case "consent": {
      if (st.phase === "greeting") {
        ws.send(msg.error("bad_message", "consent received before hello"));
        return;
      }
      if (st.phase === "consented") return; // idempotent
      if (control.captured !== true) return; // stays gated until consent is truly captured
      await markConsent(st.sessionId!, control.method, control.ts_ms);
      st.phase = "consented";
      void startCueRuntime(ws); // best-effort; never blocks the consent / RT-0 path
      return;
    }

    case "bye": {
      ws.data.runtime?.stop();
      await finalize(st, control.reason ?? "user_stopped");
      ws.close(1000, "bye");
      return;
    }
  }
}

async function onAudio(ws: WS, frame: Uint8Array) {
  const st = ws.data.conn;
  if (!audioAdmitted(st.phase)) {
    st.framesDropped++;
    if (!st.preConsentErrorSent) {
      st.preConsentErrorSent = true;
      ws.send(msg.error("consent_required", "audio received before consent was captured"));
    }
    return; // fail closed: never process audio before consent
  }
  try {
    parseAudioFrame(frame); // validate structure. RT-2 will decode PCM -> STT and call
    st.framesAccepted++; //    ws.data.runtime?.feedTranscript(seg) to drive the cue engine (RT-3).
  } catch {
    ws.send(msg.error("bad_message", "malformed audio frame"));
  }
}

async function onClose(ws: WS) {
  ws.data.runtime?.stop();
  await finalize(ws.data.conn, "disconnected");
}

// Arm the live cue engine (RT-3) for a consented session. Best-effort and fully guarded:
// with no ANTHROPIC_API_KEY the engine stays disabled and the WS runs RT-0 unchanged, and a
// failure here never touches consent, audio gating, or session lifecycle. RT-2 drives it by
// calling ws.data.runtime?.feedTranscript(seg) as the merged transcript settles.
async function startCueRuntime(ws: WS): Promise<void> {
  const st = ws.data.conn;
  if (!config.anthropicApiKey) return; // engine disabled without a key
  if (!st.sessionId || !st.tenantId || ws.data.runtime) return;
  const sessionId = st.sessionId;
  const tenantId = st.tenantId;
  try {
    const playbook = await loadPlaybook({ tenantId });
    if (!playbook) {
      console.warn(`[realtime] no active cue framework — cue engine idle for session ${sessionId}`);
      return;
    }
    if (ws.data.runtime || st.phase === "closed") return; // lost a race with close() while loading
    // TODO(RT-2): thread scheduledLengthMin (from the booking) into CueRuntime. Until it's passed,
    // the confirm_next_steps window goal AND gating_config.end_reserve_next_step stay INERT in the
    // live path — window/deadline goals depend on knowing the scheduled call length.
    ws.data.runtime = new CueRuntime({
      playbook,
      completer: anthropicCompleter(),
      onCue: async (cue) => {
        try {
          ws.send(
            msg.cue({ id: randomUUID(), tier: cue.tier, text: cue.text, category: cue.category, ttlMs: cue.ttlMs, tsMs: cue.tsMs }),
          );
        } catch {
          /* socket may be gone */
        }
        try {
          await insertLiveCue({ sessionId, tenantId, cue });
        } catch (err) {
          console.error("[realtime] failed to persist live cue", err);
          captureException(err, { where: "persist_live_cue", sessionId, tenantId });
        }
      },
    });
    console.log(`[realtime] cue engine armed for session ${sessionId} (${playbook.cues.length} cues)`);
  } catch (err) {
    console.error("[realtime] failed to start cue engine", err);
    captureException(err, { where: "start_cue_engine", sessionId, tenantId });
  }
}

// Persist the terminal state exactly once (whichever of bye / socket-close fires first).
async function finalize(st: ConnState, reason: string) {
  if (st.phase === "closed" || !st.sessionId) {
    st.phase = "closed";
    return;
  }
  const id = st.sessionId;
  st.phase = "closed"; // set before await so a concurrent close() is a no-op
  try {
    await closeLiveSession(id, reason, { accepted: st.framesAccepted, dropped: st.framesDropped });
  } catch (err) {
    console.error("[realtime] failed to close session", id, err);
    captureException(err, { where: "close_session", sessionId: id, tenantId: st.tenantId, reason });
  }
}

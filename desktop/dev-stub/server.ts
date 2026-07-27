/**
 * Dev-stub realtime server — implements desktop/PROTOCOL.md (v0).
 *
 * Stands in for the real `realtime` backend so the desktop app can be built and run end-to-end
 * on its own. It: acks `hello` with `ready`, enforces the consent gate (drops audio + replies
 * `consent_required` until consent is captured), tallies incoming audio frames per channel, and
 * emits fake cues on a timer so the overlay has something to render.
 *
 * Run:  bun run server.ts   (PORT env, default 8787)
 * NOT the production backend — that's the other lane. This shares no code with it, only PROTOCOL.md.
 */

const PORT = Number(process.env.PORT ?? 8787);
const AUDIO_HEADER_LEN = 9; // channel(1) + ts_ms(8)

type Conn = {
  sessionId: string;
  consent: boolean;
  frames: { mic: number; system: number };
  cueTimer?: ReturnType<typeof setInterval>;
  cueSeq: number;
};

const FAKE_CUES = [
  { tier: "help", category: "talk_ratio", text: "You're at 68% talk time — ask an open question." },
  { tier: "crit", category: "pitching_too_early", text: "No problem surfaced yet — hold the pitch." },
  { tier: "fyi", category: "next_step", text: "Good moment to lock a next step." },
] as const;

function send(ws: any, msg: object) {
  ws.send(JSON.stringify(msg));
}

function startCues(ws: any, c: Conn) {
  if (c.cueTimer) return;
  c.cueTimer = setInterval(() => {
    const cue = FAKE_CUES[c.cueSeq % FAKE_CUES.length];
    c.cueSeq++;
    send(ws, {
      type: "cue",
      id: `${c.sessionId}-${c.cueSeq}`,
      tier: cue.tier,
      text: cue.text,
      ttl_ms: 7000,
      category: cue.category,
      ts_ms: Date.now(),
    });
  }, 5000);
}

Bun.serve<Conn, {}>({
  port: PORT,
  fetch(req, server) {
    const ok = server.upgrade(req, {
      data: { sessionId: crypto.randomUUID(), consent: false, frames: { mic: 0, system: 0 }, cueSeq: 0 },
    });
    return ok ? undefined : new Response("websocket only", { status: 400 });
  },
  websocket: {
    open(ws) {
      console.log(`[open] ${ws.data.sessionId}`);
    },
    message(ws, message) {
      const c = ws.data;
      if (typeof message === "string") {
        let msg: any;
        try {
          msg = JSON.parse(message);
        } catch {
          return send(ws, { type: "error", code: "bad_message", message: "invalid json" });
        }
        switch (msg.type) {
          case "hello":
            console.log(`[hello] ${c.sessionId} platform=${msg.platform} rate=${msg.sample_rate}`);
            send(ws, { type: "ready", session_id: c.sessionId });
            break;
          case "consent":
            c.consent = msg.captured === true;
            console.log(`[consent] ${c.sessionId} captured=${c.consent} method=${msg.method}`);
            if (c.consent) startCues(ws, c);
            break;
          case "bye":
            console.log(`[bye] ${c.sessionId} reason=${msg.reason ?? "-"}`);
            ws.close();
            break;
          default:
            send(ws, { type: "error", code: "bad_message", message: `unknown type ${msg.type}` });
        }
        return;
      }

      // Binary = audio frame.
      const buf = message as Buffer;
      if (!c.consent) {
        return send(ws, { type: "error", code: "consent_required", message: "audio before consent" });
      }
      if (buf.length < AUDIO_HEADER_LEN) return;
      const channel = buf[0] === 0 ? "mic" : buf[0] === 1 ? "system" : null;
      if (!channel) return;
      const samples = (buf.length - AUDIO_HEADER_LEN) / 2;
      c.frames[channel]++;
      if (c.frames[channel] % 50 === 0) {
        console.log(`[audio] ${c.sessionId} ${channel} frames=${c.frames[channel]} last=${samples} samples`);
      }
    },
    close(ws) {
      const c = ws.data;
      if (c.cueTimer) clearInterval(c.cueTimer);
      console.log(`[close] ${c.sessionId} mic=${c.frames.mic} system=${c.frames.system} frames`);
    },
  },
});

console.log(`dev-stub realtime server on ws://localhost:${PORT}  (implements PROTOCOL.md v0)`);

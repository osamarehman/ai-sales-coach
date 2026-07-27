/**
 * Smoke test for the dev-stub: exercises the PROTOCOL.md handshake + consent gate end-to-end.
 * Starts the server in-process, connects a client, and asserts:
 *   hello → ready, audio-before-consent → consent_required, consent → audio accepted → a cue arrives.
 * Run: bun run smoke.ts   (exits 0 on pass, 1 on failure)
 */

const PORT = 8799;
const proc = Bun.spawn(["bun", "run", "server.ts"], {
  cwd: import.meta.dir,
  env: { ...process.env, PORT: String(PORT) },
  stdout: "inherit",
  stderr: "inherit",
});

function audioFrame(channel: number, tsMs: number, samples: number): Uint8Array {
  const buf = new Uint8Array(9 + samples * 2);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, channel);
  dv.setBigUint64(1, BigInt(tsMs), true);
  return buf; // samples left as zeros; only length matters to the stub
}

const fail = (m: string) => {
  console.error("SMOKE FAIL:", m);
  proc.kill();
  process.exit(1);
};

await Bun.sleep(400); // let the server bind

const ws = new WebSocket(`ws://localhost:${PORT}`);
const got: any[] = [];
let sawReady = false;
let sawConsentRequired = false;
let sawCue = false;

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data as string);
  got.push(msg);
  if (msg.type === "ready") sawReady = true;
  if (msg.type === "error" && msg.code === "consent_required") sawConsentRequired = true;
  if (msg.type === "cue") sawCue = true;
});

await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", () => rej(new Error("ws error")));
});

ws.send(JSON.stringify({ type: "hello", session_token: "t", app_version: "0.1.0", platform: "linux", sample_rate: 16000, frame_samples: 320 }));
await Bun.sleep(150);
if (!sawReady) fail("no ready after hello");

// Audio BEFORE consent must be rejected.
ws.send(audioFrame(0, 0, 320));
await Bun.sleep(150);
if (!sawConsentRequired) fail("audio before consent was not rejected");

// Consent, then audio should flow and a cue should eventually arrive.
ws.send(JSON.stringify({ type: "consent", captured: true, method: "checkbox", ts_ms: 0 }));
for (let i = 0; i < 60; i++) ws.send(audioFrame(i % 2, i * 20, 320));

await Bun.sleep(5500); // cue timer fires at 5s
if (!sawCue) fail("no cue after consent");

console.log(`SMOKE PASS — ready=${sawReady} consentGate=${sawConsentRequired} cue=${sawCue} (${got.length} msgs)`);
ws.close();
proc.kill();
process.exit(0);

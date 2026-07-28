// End-to-end smoke for RT-0. Proves the whole authed path + the consent gate:
//   sign up a rep -> mint a realtime token -> open the WS -> hello/ready ->
//   pre-consent audio is REJECTED -> consent -> post-consent audio is ACCEPTED -> bye.
//
// Run against an ISOLATED throwaway stack only (never prod) — see realtime/README.md:
//   docker compose -p asc-rt-dev -f <compose> up -d --build backend realtime
//   docker compose -p asc-rt-dev -f <compose> run --rm realtime bun scripts/smoke.ts

const BACKEND = process.env.SMOKE_BACKEND_URL ?? "http://backend:8080";
const REALTIME = process.env.SMOKE_REALTIME_URL ?? "ws://realtime:8081";

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  console.log(`  ok  ${label}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeFrame(channel: number, tsMs: number, samples: number): Uint8Array {
  const buf = new Uint8Array(9 + samples * 2);
  const view = new DataView(buf.buffer);
  view.setUint8(0, channel);
  view.setBigUint64(1, BigInt(tsMs), true);
  return buf;
}

async function waitForBackend(tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BACKEND}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("backend never became healthy");
}

async function main() {
  await waitForBackend();

  const email = `smoke+${Date.now()}@example.com`;
  const password = "smoke-password-123";

  // 1) sign up (autoSignIn -> session cookie; provisions a tenant + membership)
  const signup = await fetch(`${BACKEND}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "Smoke Rep" }),
  });
  assert(signup.ok, `sign-up ok (${signup.status})`);
  const cookies = (signup.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  assert(cookies.length > 0, "received a session cookie");

  // 2) mint a realtime token
  const tokenRes = await fetch(`${BACKEND}/api/realtime/token`, {
    method: "POST",
    headers: { cookie: cookies },
  });
  assert(tokenRes.ok, `token mint ok (${tokenRes.status})`);
  const { token } = (await tokenRes.json()) as { token: string };
  assert(typeof token === "string" && token.split(".").length === 3, "token is well-formed");

  // 3) open the WS + handshake
  const ws = new WebSocket(REALTIME);
  const events: any[] = [];
  const errors: any[] = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    events.push(m);
    if (m.type === "error") errors.push(m);
  });
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("ws error")));
  });

  const waitFor = (pred: () => boolean, ms = 3000) =>
    new Promise<void>((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (pred()) {
          clearInterval(iv);
          res();
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          rej(new Error("timeout"));
        }
      }, 25);
    });

  ws.send(JSON.stringify({ type: "hello", session_token: token, platform: "linux", sample_rate: 16000, frame_samples: 320 }));
  await waitFor(() => events.some((m) => m.type === "ready"));
  assert(!!events.find((m) => m.type === "ready")?.session_id, "server replied ready with a session_id");

  // 4) pre-consent audio -> rejected
  ws.send(makeFrame(0, 0, 320));
  await waitFor(() => errors.some((m) => m.code === "consent_required"));
  assert(true, "pre-consent audio rejected (consent_required)");

  // 5) consent, then audio -> accepted (no new error)
  const errsBefore = errors.length;
  ws.send(JSON.stringify({ type: "consent", captured: true, method: "checkbox", ts_ms: 100 }));
  await sleep(250);
  ws.send(makeFrame(1, 200, 320));
  await sleep(350);
  assert(errors.length === errsBefore, "post-consent audio accepted (no error)");

  // 6) bye -> server closes the socket
  const closed = new Promise<number>((res) => ws.addEventListener("close", (e) => res(e.code)));
  ws.send(JSON.stringify({ type: "bye", reason: "smoke_done" }));
  const code = await closed;
  assert(code >= 1000, `socket closed after bye (code ${code})`);

  console.log("\nRT-0 smoke PASSED");
}

main().catch((e) => {
  console.error("\nRT-0 smoke FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

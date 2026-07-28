// End-to-end ingestion smoke against the real DB, with the two external calls
// (Fathom transcript fetch + OpenRouter completion) injected so no live keys are
// needed. Exercises: tenant resolve, rep upsert, filter, dedupe, key decrypt,
// status transitions, analysis persist.  Run: docker compose exec backend bun run ingest:smoke
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db";
import { encrypt } from "../src/lib/crypto";
import { receiveWebhook, processCall } from "../src/services/ingest";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const t = await pool.query<{ id: string; webhook_token: string }>(
    "select id, webhook_token from tenants where slug = 'default'",
  );
  if (t.rows.length === 0) throw new Error("No default tenant — run: bun run seed");
  const { id: tenantId, webhook_token: token } = t.rows[0];

  // A Fathom integration must exist for the tenant (real key arrives via M4 settings).
  await pool.query(
    `insert into integrations (tenant_id, provider, encrypted_token) values ($1, 'fathom', $2)
     on conflict (tenant_id, provider) do update set encrypted_token = excluded.encrypted_token`,
    [tenantId, encrypt("dummy-fathom-key")],
  );

  const transcript = JSON.parse(
    readFileSync(join(here, "..", "fixtures", "sample-transcript.json"), "utf8"),
  );
  const analysis = readFileSync(join(here, "..", "fixtures", "sample-analysis.json"), "utf8");

  const recId = `smoke-${Date.now()}`;
  const payload = {
    recording_id: recId,
    title: "Weekly GAMEPLAN Review",
    recorded_by: { email: "alex@acme.com", name: "Alex" },
  };

  const r1 = await receiveWebhook(pool, token, payload);
  console.log(`[smoke] received: call=${r1.callId} status=${r1.status} process=${r1.process}`);
  if (!r1.process) throw new Error("expected GAMEPLAN call to be queued for processing");

  await processCall(pool, r1.callId, {
    fetchTranscriptImpl: async () => transcript, // inject: no real Fathom call
    complete: async () => analysis, // inject: no real OpenRouter call
  });
  const done = await pool.query<{ status: string }>("select status from calls where id = $1", [
    r1.callId,
  ]);
  console.log(`[smoke] final call status: ${done.rows[0].status} (expected 'analyzed')`);

  // Duplicate webhook → no-op.
  const r2 = await receiveWebhook(pool, token, payload);
  console.log(`[smoke] duplicate webhook: duplicate=${r2.duplicate} process=${r2.process}`);

  // Non-matching title → skipped, not processed.
  const r3 = await receiveWebhook(pool, token, {
    recording_id: `smoke-skip-${Date.now()}`,
    title: "random 1:1 sync",
    recorded_by: { email: "alex@acme.com" },
  });
  console.log(`[smoke] non-GAMEPLAN: status=${r3.status} process=${r3.process}`);

  // Slack path: connect + enable Slack, inject a poster (no real Slack call).
  await pool.query(
    `insert into integrations (tenant_id, provider, encrypted_token, config) values ($1, 'slack', $2, $3)
     on conflict (tenant_id, provider) do update set encrypted_token = excluded.encrypted_token, config = excluded.config`,
    [tenantId, encrypt("xoxb-dummy"), JSON.stringify({ channel_id: "C123DEMO", enabled: true })],
  );
  const posts: unknown[] = [];
  const rs = await receiveWebhook(pool, token, {
    recording_id: `smoke-slack-${Date.now()}`,
    title: "GAMEPLAN Slack Test",
    recorded_by: { email: "alex@acme.com" },
  });
  await processCall(pool, rs.callId, {
    fetchTranscriptImpl: async () => transcript,
    complete: async () => analysis,
    slackPoster: async () => {
      posts.push(1);
      return { ts: `${posts.length}.000` };
    },
  });
  const notif = await pool.query<{ status: string; thread_ts: string }>(
    "select status, thread_ts from notifications where call_id = $1",
    [rs.callId],
  );
  console.log(
    `[smoke] slack: ${posts.length} posts (expect 2 = headline + thread), ` +
      `notification=${notif.rows[0]?.status} thread_ts=${notif.rows[0]?.thread_ts}`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

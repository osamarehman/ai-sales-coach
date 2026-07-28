// Seeds a few analyzed demo calls (2 reps, varied scores incl. a disqualification)
// into a tenant so the dashboard read APIs return meaningful data.
//   docker compose exec backend bun run demo:data            # most-recent tenant
//   docker compose exec backend bun run demo:data -- <slug>  # a specific tenant
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db";
import { analysisSchema, deriveMetrics } from "../src/schemas/analysis";
import { persistAnalysis, type AnalysisResult } from "../src/services/analysis";
import { config } from "../src/config";

const here = dirname(fileURLToPath(import.meta.url));
const slugArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildResult(base: any, mutate: (a: any) => void): AnalysisResult {
  const obj = JSON.parse(JSON.stringify(base));
  mutate(obj);
  const analysis = analysisSchema.parse(obj);
  return { analysis, metrics: deriveMetrics(analysis), attempts: 1, model: config.openRouter.model };
}

async function upsertRep(tenantId: string, email: string, name: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into reps (tenant_id, email, display_name) values ($1, $2, $3)
     on conflict (tenant_id, email) do update set display_name = excluded.display_name returning id`,
    [tenantId, email, name],
  );
  return rows[0].id;
}

async function makeCall(
  tenantId: string,
  repId: string,
  recId: string,
  title: string,
  result: AnalysisResult,
): Promise<void> {
  const call = await pool.query<{ id: string }>(
    `insert into calls (tenant_id, recording_id, source, title, rep_id, status)
     values ($1, $2, 'demo', $3, $4, 'analyzed')
     on conflict (tenant_id, recording_id) do update set status = 'analyzed', rep_id = excluded.rep_id
     returning id`,
    [tenantId, recId, title, repId],
  );
  await persistAnalysis(pool, { tenantId, callId: call.rows[0].id, result });
}

async function main() {
  const t = slugArg
    ? await pool.query<{ id: string; slug: string }>("select id, slug from tenants where slug = $1", [slugArg])
    : await pool.query<{ id: string; slug: string }>(
        "select id, slug from tenants order by created_at desc limit 1",
      );
  if (t.rows.length === 0) throw new Error("no matching tenant");
  const tenantId = t.rows[0].id;
  console.log(`[demo] tenant '${t.rows[0].slug}' (${tenantId})`);

  const base = JSON.parse(readFileSync(join(here, "..", "fixtures", "sample-analysis.json"), "utf8"));
  const rep1 = await upsertRep(tenantId, "rep.one@demo.com", "Riley One");
  const rep2 = await upsertRep(tenantId, "rep.two@demo.com", "Casey Two");

  await makeCall(tenantId, rep1, "demo-1", "Acme Corp — GAMEPLAN", buildResult(base, () => {}));
  await makeCall(
    tenantId,
    rep2,
    "demo-2",
    "Globex — GAMEPLAN",
    buildResult(base, (a) => {
      a.evaluations[3].rating = "No";
      a.evaluations[3].score = 0;
      a.evaluations[5].rating = "Partial";
      a.evaluations[5].score = 4.55;
    }),
  );
  await makeCall(
    tenantId,
    rep1,
    "demo-3",
    "Initech — GAMEPLAN",
    buildResult(base, (a) => {
      a.evaluations[4].rating = "Disqualified";
      a.evaluations[4].score = 6.82;
      a.disqualification_summary.was_disqualified = true;
      a.disqualification_summary.disqualified_criteria = ["E - Economic Resources"];
    }),
  );

  const n = await pool.query<{ c: number }>("select count(*)::int as c from calls where tenant_id = $1", [
    tenantId,
  ]);
  console.log(`[demo] tenant now has ${n.rows[0].c} calls`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

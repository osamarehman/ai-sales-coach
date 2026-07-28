// Exercises the M2 analysis engine end-to-end against a fixture transcript and
// persists a scorecard under the default tenant.
//   docker compose exec backend bun run analyze:fixture -- --mock   (no API key)
//   docker compose exec backend bun run analyze:fixture              (real OpenRouter)
//   docker compose exec backend bun run analyze:fixture -- path/to/transcript.json
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db";
import { formatTranscript } from "../src/services/transcript";
import { runAnalysis, persistAnalysis, type Completer } from "../src/services/analysis";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mock = argv.includes("--mock");
const transcriptPath =
  argv.find((a) => !a.startsWith("--")) ?? join(here, "..", "fixtures", "sample-transcript.json");

async function main() {
  const transcriptText = formatTranscript(JSON.parse(readFileSync(transcriptPath, "utf8")));
  console.log(
    `[analyze] transcript: ${transcriptText.split("\n").length} lines, ${transcriptText.length} chars`,
  );

  const t = await pool.query<{ id: string }>("select id from tenants where slug = 'default'");
  if (t.rows.length === 0) throw new Error("No default tenant — run: bun run seed");
  const tenantId = t.rows[0].id;

  const r = await pool.query<{ id: string; system_prompt: string }>(
    "select id, system_prompt from rubrics where tenant_id = $1 and is_active order by version desc limit 1",
    [tenantId],
  );
  if (r.rows.length === 0) throw new Error("No active rubric — run: bun run seed");
  const rubricId = r.rows[0].id;

  let complete: Completer | undefined;
  if (mock) {
    const fixture = readFileSync(join(here, "..", "fixtures", "sample-analysis.json"), "utf8");
    complete = async () => fixture;
    console.log("[analyze] MOCK mode — using fixtures/sample-analysis.json (no API call)");
  }

  const result = await runAnalysis({ systemPrompt: r.rows[0].system_prompt, transcriptText, complete });
  console.log(
    `[analyze] validated ✓ ${result.attempts} attempt(s), model ${result.model}, ` +
      `${result.analysis.evaluations.length} evaluations, total ${result.metrics.total_score}, ${result.metrics.outcome}`,
  );

  const recordingId = `fixture-${transcriptText.length}`;
  const call = await pool.query<{ id: string }>(
    `insert into calls (tenant_id, recording_id, source, title, status)
     values ($1, $2, 'fixture', $3, 'analyzed')
     on conflict (tenant_id, recording_id) do update set status = 'analyzed'
     returning id`,
    [tenantId, recordingId, "Fixture Sales Call — GAMEPLAN"],
  );
  const analysisId = await persistAnalysis(pool, {
    tenantId,
    callId: call.rows[0].id,
    rubricId,
    result,
  });
  console.log(`[analyze] persisted analysis ${analysisId} for call ${call.rows[0].id}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

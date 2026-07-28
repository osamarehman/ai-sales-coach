// Seeds a default tenant + the default H.E.A.R.T. rubric (from backend/prompts/).
// Idempotent: re-running keeps the existing tenant (and its stable webhook_token)
// and refreshes the rubric prompt text. Run: docker compose exec backend bun run seed
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { pool } from "../src/db";

const here = dirname(fileURLToPath(import.meta.url));
const promptPath = join(here, "..", "prompts", "sales-analysis.system.md");

async function main() {
  const systemPrompt = readFileSync(promptPath, "utf8");
  const webhookToken = randomBytes(24).toString("hex");

  const tenant = await pool.query<{ id: string; slug: string; webhook_token: string }>(
    `insert into tenants (name, slug, webhook_token)
     values ($1, $2, $3)
     on conflict (slug) do update set name = excluded.name
     returning id, slug, webhook_token`,
    ["Default Workspace", "default", webhookToken],
  );
  const { id: tenantId, slug, webhook_token } = tenant.rows[0];
  console.log(`[seed] tenant '${slug}' -> ${tenantId} (webhook token ${webhook_token.slice(0, 8)}…)`);

  await pool.query(
    `insert into rubrics (tenant_id, version, name, system_prompt, is_active)
     values ($1, 1, $2, $3, true)
     on conflict (tenant_id, version) do update set system_prompt = excluded.system_prompt`,
    [tenantId, "H.E.A.R.T. 11-criteria (default)", systemPrompt],
  );
  console.log(`[seed] rubric v1 seeded (${systemPrompt.length} chars)`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

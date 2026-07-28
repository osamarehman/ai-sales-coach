// Seeds the global default cue framework from backend/data/cue-framework/:
//   framework.default.json     -> cue_frameworks (header: stage_model + gating_config)
//   knowledge.*.json           -> cue_knowledge  (de-branded retrievable entries)
//   cues.default.json          -> cue_definitions (the ~23 live cue rules)
//   goals.default.json         -> cue_goals       (the scheduled goals)
// Idempotent + deterministic: upserts the framework (by slug, tenant_id NULL) preserving
// its id, then fully rebuilds each child table (delete + reinsert) so a re-run exactly
// mirrors disk. Picks up any knowledge.*.json, so new source files need no code change.
// Run: docker compose exec backend bun run seed:cues
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "cue-framework");
const readJson = (name: string): any => JSON.parse(readFileSync(join(dataDir, name), "utf8"));
const readJsonIf = (name: string): any | null => (existsSync(join(dataDir, name)) ? readJson(name) : null);

async function main() {
  const fw = readJson("framework.default.json");

  const knowledgeFiles = readdirSync(dataDir)
    .filter((f) => f.startsWith("knowledge.") && f.endsWith(".json"))
    .sort();
  const entries: any[] = [];
  for (const f of knowledgeFiles) entries.push(...(readJson(f).entries ?? []));

  const cues: any[] = readJsonIf("cues.default.json")?.cues ?? [];
  const goals: any[] = readJsonIf("goals.default.json")?.goals ?? [];

  const client = await pool.connect();
  try {
    await client.query("begin");

    // Upsert the global default framework (tenant_id NULL), preserving its id across runs.
    const existing = await client.query<{ id: string }>(
      "select id from cue_frameworks where tenant_id is null and slug = $1 and version = $2",
      [fw.slug, fw.version],
    );
    let frameworkId: string;
    if (existing.rows.length) {
      frameworkId = existing.rows[0].id;
      await client.query(
        "update cue_frameworks set name = $2, status = $3, stage_model = $4, gating_config = $5 where id = $1",
        [frameworkId, fw.name, fw.status, JSON.stringify(fw.stage_model), JSON.stringify(fw.gating_config)],
      );
    } else {
      const ins = await client.query<{ id: string }>(
        `insert into cue_frameworks (tenant_id, slug, name, version, status, stage_model, gating_config)
         values (null, $1, $2, $3, $4, $5, $6) returning id`,
        [fw.slug, fw.name, fw.version, fw.status, JSON.stringify(fw.stage_model), JSON.stringify(fw.gating_config)],
      );
      frameworkId = ins.rows[0].id;
    }

    // Rebuild each child table deterministically.
    await client.query("delete from cue_knowledge where framework_id = $1", [frameworkId]);
    for (const e of entries) {
      await client.query(
        `insert into cue_knowledge
           (framework_id, kind, category, stage, objection_type, title, summary,
            content, tags, trigger_signal, priority, source_ref)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          frameworkId, e.kind, e.category ?? null, e.stage ?? null, e.objection_type ?? null,
          e.title, e.summary,
          // Fold a top-level `examples` array into content so authored phrasings aren't dropped.
          JSON.stringify(e.examples?.length ? { ...(e.content ?? {}), examples: e.examples } : (e.content ?? {})),
          e.tags ?? [],
          e.trigger_signal ?? null, e.priority ?? null, e.source_ref ? JSON.stringify(e.source_ref) : null,
        ],
      );
    }

    await client.query("delete from cue_definitions where framework_id = $1", [frameworkId]);
    for (const c of cues) {
      await client.query(
        `insert into cue_definitions
           (framework_id, cue_key, name, category, stage, trigger_signal, cue_text, priority, confidence_min, cooldown_s, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          frameworkId, c.cue_key, c.name, c.category ?? null, c.stage ?? null, c.trigger_signal,
          c.cue_text, c.priority, c.confidence_min ?? null, c.cooldown_s ?? null, c.sort_order ?? 0,
        ],
      );
    }

    await client.query("delete from cue_goals where framework_id = $1", [frameworkId]);
    for (const g of goals) {
      await client.query(
        `insert into cue_goals
           (framework_id, goal_key, label, type, arm, disarm, condition, satisfied_by, cue_text, priority, config, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          frameworkId, g.goal_key, g.label, g.type, g.arm ?? null, g.disarm ?? null, g.condition ?? null,
          g.satisfied_by ?? null, g.cue_text, g.priority, JSON.stringify(g.config ?? {}), g.sort_order ?? 0,
        ],
      );
    }

    await client.query("commit");
    console.log(
      `[seed:cues] framework '${fw.slug}' -> ${frameworkId}\n` +
        `  ${entries.length} knowledge (from ${knowledgeFiles.length} file(s): ${knowledgeFiles.join(", ")})\n` +
        `  ${cues.length} cue definitions, ${goals.length} scheduled goals`,
    );
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

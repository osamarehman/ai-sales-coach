// Smoke test for the cue-framework retrieval service against a live DB.
// Requires DATABASE_URL + a seeded framework (`bun run seed:cues` in backend).
// Run: DATABASE_URL=... bun scripts/framework-smoke.ts
import { pool } from "../src/db";
import { loadPlaybook, retrieveKnowledge } from "../src/framework";

async function main() {
  const pb = await loadPlaybook({});
  if (!pb) throw new Error("no framework found — run `bun run seed:cues` in backend first");

  const stages = (pb.framework.stageModel as unknown[]).length;
  console.log(`framework: ${pb.framework.name} (${pb.framework.slug} v${pb.framework.version}) — ${stages} stages`);
  console.log(`cues: ${pb.cues.length}, goals: ${pb.goals.length}`);
  console.log("first 3 cues:", pb.cues.slice(0, 3).map((c) => `[${c.priority}] ${c.cueText}`).join("  |  "));
  console.log("first 3 goals:", pb.goals.slice(0, 3).map((g) => `[${g.type}] ${g.label}`).join("  |  "));

  const price = await retrieveKnowledge(pb.framework.id, { objectionType: "price" });
  console.log(`\nretrieve objection_type=price -> ${price.length} entry(ies)`);
  for (const e of price) {
    const c = e.content as any;
    console.log(`  [${e.kind}] ${e.title} :: "${c.diffuse?.[0] ?? c.clarify?.[0] ?? ""}"`);
  }

  const conseq = await retrieveKnowledge(pb.framework.id, { kind: "question_bank", stage: "consequence" });
  console.log(`\nretrieve kind=question_bank stage=consequence -> ${conseq.length} bank(s)`);
  for (const e of conseq.slice(0, 2)) {
    const qs = (e.content as any).questions ?? [];
    console.log(`  ${e.title} (${qs.length} q's) e.g. "${qs[0] ?? ""}"`);
  }

  const tagged = await retrieveKnowledge(pb.framework.id, { tags: ["diffuse"], limit: 5 });
  console.log(`\nretrieve tags=[diffuse] -> ${tagged.length} entry(ies): ${tagged.map((e) => e.objectionType ?? e.title).join(", ")}`);

  console.log("\nframework-smoke OK");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

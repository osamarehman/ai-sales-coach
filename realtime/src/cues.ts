import { pool } from "./db";
import type { EmittedCue } from "./arbiter";

// The only writer of live_cues (schema in backend/migrations/0009_live_cues.sql) — part of
// the isolated realtime subsystem, so it never touches calls/analyses. One row per cue that
// survived the arbiter and was sent to the overlay. Parameterized SQL only.
export async function insertLiveCue(input: {
  sessionId: string;
  tenantId: string;
  cue: EmittedCue;
}): Promise<void> {
  const c = input.cue;
  await pool.query(
    `insert into live_cues
       (session_id, tenant_id, cue_key, tier, category, text, confidence, reason, stage, ts_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [input.sessionId, input.tenantId, c.cueKey, c.tier, c.category, c.text, c.confidence, c.reason, c.stage, c.tsMs],
  );
}

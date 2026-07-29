import { pool } from "./db";
import type { TranscriptSegment } from "./transcript";

// The only writer of live_transcript_segments (schema in
// backend/migrations/0010_live_transcript_segments.sql) — part of the isolated realtime
// subsystem, so it never touches calls/analyses. One row per FINAL segment the STT relay
// (RT-2) fed to the cue engine. Parameterized SQL only.
export async function insertLiveTranscriptSegment(input: {
  sessionId: string;
  tenantId: string;
  seg: TranscriptSegment;
}): Promise<void> {
  const s = input.seg;
  await pool.query(
    `insert into live_transcript_segments
       (session_id, tenant_id, speaker, text, start_ms, end_ms)
     values ($1,$2,$3,$4,$5,$6)`,
    [input.sessionId, input.tenantId, s.speaker, s.text, s.startMs, s.endMs],
  );
}

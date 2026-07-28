import { pool } from "./db";

// DB mechanics for the isolated real-time subsystem. Writes ONLY live_sessions
// (schema in backend/migrations/0006_live_sessions.sql). Never reads/writes
// calls/analyses — that isolation is the whole point of the separate service.

export async function createLiveSession(input: {
  tenantId: string;
  userId: string;
  platform?: string;
  appVersion?: string;
  sampleRate?: number;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into live_sessions (tenant_id, user_id, platform, app_version, sample_rate)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [input.tenantId, input.userId, input.platform ?? null, input.appVersion ?? null, input.sampleRate ?? null],
  );
  return rows[0].id;
}

export async function markConsent(
  id: string,
  method: string | undefined,
  tsMs: number | undefined,
): Promise<void> {
  await pool.query(
    `update live_sessions
        set consent_captured = true, status = 'consented', consent_method = $2, consent_ts_ms = $3
      where id = $1`,
    [id, method ?? null, tsMs ?? null],
  );
}

export async function closeLiveSession(
  id: string,
  reason: string | undefined,
  stats: { accepted: number; dropped: number },
): Promise<void> {
  await pool.query(
    `update live_sessions
        set status = 'closed', ended_at = now(), end_reason = $2,
            frames_accepted = $3, frames_dropped = $4
      where id = $1`,
    [id, reason ?? null, stats.accepted, stats.dropped],
  );
}

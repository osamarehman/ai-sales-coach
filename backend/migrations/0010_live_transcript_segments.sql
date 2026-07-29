-- 0010_live_transcript_segments: speaker-tagged transcript segments produced by the live
-- STT relay (RT-2). Part of the isolated real-time subsystem — the `realtime` service writes
-- ONLY live_* tables, so a live-coaching failure can never touch the post-call grader.
-- One row per FINAL (VAD-committed) segment fed to the cue engine. Timestamps are the CALL
-- CLOCK (ms since session start), matching live_cues.ts_ms and the desktop capture clock.

create table if not exists live_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  speaker text not null,                          -- rep | prospect (from the capture channel, NOT model diarization)
  text text not null,                             -- the settled utterance text (STT output)
  start_ms bigint not null,                       -- call-clock ms (since session start) the utterance began
  end_ms bigint not null,                         -- call-clock ms it ended (used for ordering + windowing)
  created_at timestamptz not null default now()
);

create index if not exists idx_live_transcript_session on live_transcript_segments (session_id, start_ms);

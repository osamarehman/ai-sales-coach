-- 0009_live_cues: cues emitted by the live coaching engine (RT-3).
-- Part of the isolated real-time subsystem — the `realtime` service writes ONLY
-- live_* tables, so a live-coaching failure can never touch the post-call grader.
-- One row per cue that survived the arbiter's gating and was sent to the overlay.

create table if not exists live_cues (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  cue_key text not null,                          -- which cue definition fired (cue_definitions.cue_key)
  tier text not null,                             -- crit | help | fyi (maps priority -> overlay tier)
  category text,                                  -- free-form tag from the cue framework
  text text not null,                             -- rep-facing nudge (the authored cue_text — never LLM free-text)
  confidence numeric,                             -- engine's calibrated probability the trigger held
  reason text,                                    -- INTERNAL rationale for logs/tuning; never rendered to the rep
  stage text,                                     -- stage the engine detected when it fired
  ts_ms bigint,                                   -- call-clock ms (since session start) when it fired
  created_at timestamptz not null default now()
);

create index if not exists idx_live_cues_session on live_cues (session_id, created_at);

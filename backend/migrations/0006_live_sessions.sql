-- 0006_live_sessions: foundation for the isolated real-time coaching subsystem (RT-0).
-- The separate `realtime` WebSocket service writes ONLY this table; it never reads or
-- writes calls/analyses, so a live-coaching failure can't break the post-call grader.
-- Owned here (one migration runner, one schema source of truth) though written by realtime.

create table if not exists live_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id text not null,                          -- BetterAuth user id (text), from the session token
  status text not null default 'open',            -- open | consented | closed
  consent_captured boolean not null default false,
  consent_method text,                            -- spoken | checkbox
  consent_ts_ms bigint,                           -- ms since session start (client clock)
  platform text,                                  -- linux | macos | windows
  app_version text,
  sample_rate int,
  frames_accepted int not null default 0,         -- audio frames processed (post-consent)
  frames_dropped int not null default 0,          -- audio frames rejected (pre-consent / malformed)
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text                                 -- user_stopped | disconnected | ...
);

create index if not exists idx_live_sessions_tenant_started on live_sessions (tenant_id, started_at desc);

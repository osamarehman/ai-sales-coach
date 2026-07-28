-- The live cue engine's RULE set (companion to cue_knowledge): the fire-when cue
-- definitions + the stateful scheduled goals, per framework. Reference/config data,
-- seeded via `bun run seed:cues`, read by the realtime cue engine at call start.

-- The ~23 cue definitions: each fires from a detectable signal condition.
create table if not exists cue_definitions (
  id             uuid primary key default gen_random_uuid(),
  framework_id   uuid not null references cue_frameworks(id) on delete cascade,
  cue_key        text not null,          -- stable slug, e.g. 'talk_ratio_critical'
  name           text not null,
  category       text,                   -- talk_ratio | monologue | question_density | discovery_gap | sequence | tonality | delivery | interruption | patience | objection | buying_signal | next_step
  stage          text,                   -- our stage slug (nullable; some cues are stage-agnostic)
  trigger_signal text not null,          -- precise, detectable condition (transcript/prosody signals)
  cue_text       text not null,          -- imperative on-screen text (short)
  priority       text not null,          -- critical | helpful | fyi
  confidence_min numeric,                -- null => use framework.gating_config.confidence_min[priority]
  cooldown_s     int,                    -- per-cue debounce; null => use the global min-gap
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create unique index if not exists idx_cue_definitions_key on cue_definitions (framework_id, cue_key);
create index if not exists idx_cue_definitions_framework on cue_definitions (framework_id, priority);

-- The scheduled/queued GOALS: small fire-once state machines (deadline/watch/window/guard).
create table if not exists cue_goals (
  id           uuid primary key default gen_random_uuid(),
  framework_id uuid not null references cue_frameworks(id) on delete cascade,
  goal_key     text not null,            -- stable slug, e.g. 'problem_awareness_by_6'
  label        text not null,
  type         text not null,            -- deadline | watch | window | guard
  arm          text,                     -- when it arms (call-clock time or event)
  disarm       text,                     -- when it disarms (nullable)
  condition    text,                     -- predicate that fires the goal (evaluated while armed)
  satisfied_by text,                     -- predicate that cancels it (goal already met)
  cue_text     text not null,
  priority     text not null,            -- critical | helpful | fyi
  config       jsonb not null default '{}',  -- extra params (deadline_sec, window, ...)
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create unique index if not exists idx_cue_goals_key on cue_goals (framework_id, goal_key);
create index if not exists idx_cue_goals_framework on cue_goals (framework_id);

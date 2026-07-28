-- 0001_init: multi-tenant foundation for AI Sales Coach.
-- Every domain table carries tenant_id and cascades from tenants.
-- gen_random_uuid() is built into Postgres 13+ core (no extension needed).

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  webhook_token text not null unique,          -- opaque token in the Fathom webhook URL path
  call_filter_keyword text not null default 'GAMEPLAN',
  created_at timestamptz not null default now()
);

create table if not exists reps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,                          -- from Fathom recorded_by.email
  display_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,                       -- 'fathom' | 'slack'
  encrypted_token text,                         -- AES-GCM ciphertext; never plaintext
  config jsonb not null default '{}'::jsonb,    -- e.g. slack channel id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table if not exists rubrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  version int not null default 1,
  name text,
  system_prompt text not null,                  -- the grader prompt (the product IP)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recording_id text not null,                   -- Fathom recording id
  source text not null default 'fathom',
  title text,
  rep_id uuid references reps(id) on delete set null,
  status text not null default 'received',      -- received|skipped|fetching|analyzing|analyzed|failed
  raw_transcript jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, recording_id)              -- dedupe repeated webhooks
);

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  rubric_id uuid references rubrics(id) on delete set null,
  model text,
  raw_json jsonb not null,                      -- full validated LLM output
  total_score numeric,                          -- sum of the 11 criterion scores
  outcome text,                                 -- won|lost|disqualified
  was_disqualified boolean,
  created_at timestamptz not null default now(),
  unique (call_id)                              -- one analysis per call (for now)
);

create index if not exists idx_calls_tenant_status  on calls (tenant_id, status);
create index if not exists idx_calls_tenant_rep      on calls (tenant_id, rep_id);
create index if not exists idx_calls_tenant_created  on calls (tenant_id, created_at desc);
create index if not exists idx_analyses_tenant_created on analyses (tenant_id, created_at desc);
create index if not exists idx_analyses_tenant_outcome on analyses (tenant_id, outcome);

-- Cue-framework knowledge store: versioned coaching frameworks + the de-branded,
-- retrievable knowledge the live cue engine queries. Reference/config data (seeded at
-- build time via `bun run seed:cues`), NOT per-call runtime state — hence not named live_*.

create table if not exists cue_frameworks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenants(id) on delete cascade,   -- NULL = global default framework
  slug          text not null,
  name          text not null,
  version       int  not null default 1,
  status        text not null default 'active',                  -- draft | active | archived
  stage_model   jsonb not null default '[]',                     -- our ordered stage list
  gating_config jsonb not null default '{}',                     -- alert-fatigue defaults
  created_at    timestamptz not null default now()
);
-- Per-tenant frameworks are unique by (tenant, slug, version)...
create unique index if not exists idx_cue_frameworks_tenant_slug_ver
  on cue_frameworks (tenant_id, slug, version) where tenant_id is not null;
-- ...and the global default (tenant_id NULL) is unique by (slug, version), since a NULL
-- tenant_id would otherwise defeat the composite unique constraint (NULL <> NULL in SQL).
create unique index if not exists idx_cue_frameworks_global_slug_ver
  on cue_frameworks (slug, version) where tenant_id is null;

-- The retrievable knowledge extracted from source material, de-branded + restated in our
-- own words. The live cue engine queries by (framework_id, kind, stage | objection_type, tags)
-- to compose cues and post-call follow-ups. source_ref is INTERNAL provenance only.
create table if not exists cue_knowledge (
  id             uuid primary key default gen_random_uuid(),
  framework_id   uuid not null references cue_frameworks(id) on delete cascade,
  kind           text not null,          -- principle | question_bank | objection_pattern | ...
  category       text,                   -- clarify | diffuse | defer | checkin | objection_method | ...
  stage          text,                   -- our stage slug (nullable)
  objection_type text,                   -- our objection slug (nullable; set when kind=objection_pattern)
  title          text not null,
  summary        text not null,          -- our restatement (de-branded, never verbatim)
  content        jsonb not null default '{}',   -- kind-specific: moves / question lists / examples
  tags           text[] not null default '{}',
  trigger_signal text,                   -- how the live engine detects relevance (ties to signal layer)
  priority       text,                   -- critical | helpful | fyi
  source_ref     jsonb,                  -- INTERNAL provenance {doc, pages}; never surfaced to users
  created_at     timestamptz not null default now()
);

create index if not exists idx_cue_knowledge_framework_kind_stage
  on cue_knowledge (framework_id, kind, stage);
create index if not exists idx_cue_knowledge_objection
  on cue_knowledge (framework_id, objection_type);
create index if not exists idx_cue_knowledge_tags
  on cue_knowledge using gin (tags);

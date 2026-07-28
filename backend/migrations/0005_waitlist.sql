-- 0005_waitlist: early-access email capture for the waitlist landing page.
-- Standalone (no tenant_id): these are prospects, not tenants yet. The public,
-- unauthenticated POST /api/waitlist writes here (see routes/waitlist.ts). Email is
-- stored lowercased + trimmed and deduped via the unique constraint.
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'landing',
  created_at timestamptz not null default now()
);

create index if not exists idx_waitlist_created on waitlist (created_at desc);

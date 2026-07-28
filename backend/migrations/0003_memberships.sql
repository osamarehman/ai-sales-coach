-- 0003_memberships: link BetterAuth users to tenants.
-- BetterAuth owns the "user" table, so we key on its text user id without a hard FK.
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null default 'member',       -- owner|admin|member
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);

create index if not exists idx_memberships_user on memberships (user_id);
create index if not exists idx_memberships_tenant on memberships (tenant_id);

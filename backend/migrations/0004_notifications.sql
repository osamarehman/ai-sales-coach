-- 0004_notifications: log of outbound notifications (Slack today) per call.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  channel text not null,                 -- 'slack'
  target text,                           -- slack channel id
  thread_ts text,                        -- slack message timestamp (thread root)
  status text not null,                  -- sent|failed
  detail text,                           -- error message when failed
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_tenant_call on notifications (tenant_id, call_id);

-- Additive — on-demand "Site Health" checks (Care tier: uptime + SSL) for
-- every client, regardless of add-on services. One row per check, most-recent
-- read by the dashboard; no scheduler, always triggered by a live page load or
-- an explicit "Check now" click (see lib/site-health.ts). Safe to run.

create table if not exists site_health_checks (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  checked_at        timestamptz not null default now(),
  up                boolean not null,
  status_code       integer,
  response_time_ms  integer,
  error             text,               -- set when `up` is false (fetch failed) — timeout, DNS, refused, etc.
  ssl_valid         boolean,            -- null when the site isn't served over https at all
  ssl_issuer        text,
  ssl_expires_at    timestamptz,
  ssl_days_remaining integer
);
create index if not exists site_health_checks_client_idx on site_health_checks (client_id, checked_at desc);

alter table site_health_checks enable row level security;

-- Additive — Paid Ads (Google PPC) reporting snapshots. Daily cache of a
-- client's Google Ads performance, so trends survive and dashboard loads don't
-- hit the Ads API live every time. Mirrors gsc_snapshots exactly. Data is pulled
-- read-only from the client's Google Ads account (Hyperbole has manager/MCC
-- access); the client pays Google directly. Safe to run.

create table if not exists ads_snapshots (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  date       date not null,
  -- { spendCents, impressions, clicks, conversions, conversionsValue, costPerLeadCents, avgCpcCents }
  totals     jsonb not null,
  -- [{ id, name, status, spendCents, impressions, clicks, conversions }]
  campaigns  jsonb not null,
  created_at timestamptz not null default now(),
  unique (client_id, date)
);
create index if not exists ads_snapshots_client_idx on ads_snapshots (client_id, date desc);
alter table ads_snapshots enable row level security;

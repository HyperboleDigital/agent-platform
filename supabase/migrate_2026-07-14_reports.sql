-- Additive migration for the existing DB — Phase 4 slice 6 (client reports).
-- Safe to run: only adds what's missing, never drops or rewrites existing data.
-- Paste into the Supabase SQL editor.

-- A generated report is a persisted SNAPSHOT of the metrics at generation
-- time (data jsonb), so historical reports don't drift as underlying data
-- changes. sent_at/sent_to record the ONE manual send (email guardrail: no
-- auto/scheduled sending — see lib/reports.ts + lib/notify.ts).
create table if not exists reports (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  sent_to       text
);
create index if not exists reports_client_idx on reports (client_id, created_at desc);

alter table reports enable row level security;

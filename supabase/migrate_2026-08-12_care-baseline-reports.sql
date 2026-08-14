-- Care tier: technical SEO baseline + automated monthly health report.
--
-- Two tables:
--   site_baselines    — point-in-time snapshot of the four baseline checks
--                       (speed, meta, mobile, indexing) so the monthly report
--                       can show movement rather than only a current reading.
--   report_deliveries — the idempotency ledger for automated report email.
--
-- report_deliveries is the safety mechanism, not bookkeeping. Report email is
-- now scheduler-driven, which the codebase previously forbade outright after an
-- incident where 582 emails were auto-sent to a real inbox from an unbounded
-- loop. The unique constraint on (client_id, period_key) is what makes a repeat
-- physically impossible: the sender CLAIMS a period by inserting this row first
-- and only sends if the insert succeeded. A crash, a double-fired timer, two API
-- instances, or a restart mid-send can therefore never produce a second email
-- for the same client and month — the database rejects the second claim.

create table if not exists site_baselines (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  url         text not null,
  -- 0-100 Lighthouse mobile performance score; null when PageSpeed failed.
  mobile_score integer,
  -- BaselineCheck[] — see apps/api/src/lib/site-baseline.ts
  checks      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists site_baselines_client_idx
  on site_baselines (client_id, created_at desc);

create table if not exists report_deliveries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  -- 'YYYY-MM' of the period the report covers. Together with client_id this is
  -- the once-and-only-once key; see the note above.
  period_key  text not null,
  report_id   uuid references reports(id) on delete set null,
  -- 'sent' | 'skipped' | 'failed' — a claimed period that did NOT send still
  -- occupies the row, so a failure is visible instead of silently retried
  -- forever. Re-sending a failed period is a deliberate manual act.
  status      text not null default 'sent',
  recipient   text,
  detail      text,
  created_at  timestamptz not null default now()
);
create unique index if not exists report_deliveries_once_idx
  on report_deliveries (client_id, period_key);

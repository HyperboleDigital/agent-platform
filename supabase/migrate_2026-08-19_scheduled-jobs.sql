-- Scheduled jobs backbone (handoff #2 §1). One row per client × job type.
-- Jobs are AUTO-PROVISIONED from tier + add-on entitlements by
-- lib/scheduled-jobs.ts reconcile — never insert rows by hand: a hand-made row
-- will be disabled at the next reconcile if the entitlement doesn't back it.
--
-- job_type is deliberately unconstrained text: the registry of valid types and
-- their handlers lives in lib/scheduled-jobs.ts (JOB_DEFS), and a check
-- constraint here would mean a migration for every new job type.
create table if not exists scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  job_type text not null,          -- see JOB_DEFS in lib/scheduled-jobs.ts
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  day_of_month integer,            -- for monthly jobs
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_status text,                -- 'ok' | 'failed' | 'partial'
  last_error text,
  next_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists scheduled_jobs_due_idx on scheduled_jobs(enabled, next_run_at);
-- One job of each type per client — this is what makes reconcile idempotent.
create unique index if not exists scheduled_jobs_client_type_idx on scheduled_jobs(client_id, job_type);

-- Job runs: the audit trail under scheduled_jobs (handoff #3 §1a). One row per
-- execution (scheduled tick or superadmin run-now) with what it cost, so:
--   1. the per-client monthly job budget can be enforced by SUMMING real spend
--      (portalConfig.jobBudgetCents, default 500 = $5/mo) before any paid job
--      (crawl / rank_check / visibility_poll) is allowed to start, and
--   2. the "This month" panel can list what actually ran for a client.
--
-- scheduled_jobs.last_* stays as the "current state at a glance" cache; this
-- table is the history. Rows are inserted at claim time (status 'running') and
-- finalized when the handler returns — a crash leaves a visible 'running' row
-- that the dispatcher sweeps to 'failed' after 30 minutes, mirroring the
-- release-stuck-crawl pattern in routes/clients.ts.

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  -- Kept when the parent job row is deleted so cost history survives; the
  -- client cascade below is the real lifetime owner.
  job_id uuid references scheduled_jobs(id) on delete set null,
  client_id uuid references clients(id) on delete cascade,
  job_type text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 'running' | 'ok' | 'partial' | 'failed' | 'budget_exceeded' | 'setup_incomplete'
  status text not null default 'running',
  error text,
  -- Real cost where the vendor reports one (DataForSEO), a documented
  -- conservative estimate otherwise (SERP/LLM legs). Numeric, not integer:
  -- a 10-page crawl is 1.8 cents and rounding every run up would overstate
  -- spend ~3x at current volumes.
  cost_cents numeric not null default 0,
  summary jsonb
);
create index if not exists job_runs_client_month_idx on job_runs (client_id, started_at desc);
create index if not exists job_runs_job_idx on job_runs (job_id, started_at desc);

-- Service-key access only (same as scheduled_jobs); no anon policies.
alter table job_runs enable row level security;

-- "Cost of the last run" at a glance on the jobs views, without a join.
alter table scheduled_jobs add column if not exists last_cost_cents numeric;

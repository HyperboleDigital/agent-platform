-- Additive — backs the one-click concept wizard.
--
-- Concept generation is a multi-minute, multi-step, multi-provider job (scrape
-- -> design analysis -> layout image -> stock photos -> HTML -> layout audit).
-- Previously each step was its own dashboard button holding an HTTP connection
-- open for as long as the step took; the full-fat path ran ~3 minutes on one
-- request, which is fragile behind any proxy and gives the operator no idea
-- what is happening or what it cost.
--
-- This makes a run a first-class row that the job writes progress into and the
-- dashboard polls — the same shape seo_crawls already uses for DataForSEO
-- (status column, background finalisation), rather than introducing SSE or a
-- websocket for one feature.
--
-- Safe to run.
create table if not exists prospect_generation_runs (
  id            uuid primary key default gen_random_uuid(),
  prospect_id   uuid not null references prospects(id) on delete cascade,
  status        text not null default 'running' check (status in ('running', 'done', 'error')),
  -- Ordered step list, each { key, label, status, pct, detail, costMicros }.
  -- jsonb rather than a child table: steps are written on every progress tick
  -- and only ever read as a whole, so a row rewrite beats a join, and adding a
  -- step later needs no migration.
  steps         jsonb not null default '[]'::jsonb,
  current_step  text,
  -- The concept this run produced, once it gets that far.
  mockup_id     uuid references prospect_mockups(id) on delete set null,
  -- Millionths of a USD, integer. Provider prices are quoted per million
  -- tokens and to fractions of a cent, so cents would round away most of a
  -- run's cost and floats would drift as they accumulate across steps.
  cost_micros   bigint not null default 0,
  -- Per-item breakdown: { step, provider, model, kind, qty, micros }.
  cost_detail   jsonb not null default '[]'::jsonb,
  -- What the operator asked for (aiPhotos, layoutFirst, library, etc), so a
  -- run stays interpretable after the fact.
  options       jsonb not null default '{}'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists prospect_generation_runs_prospect_idx
  on prospect_generation_runs (prospect_id, created_at desc);
-- Drives the "is anything running for this prospect" lookup the dashboard does
-- on load, without scanning finished runs.
create index if not exists prospect_generation_runs_running_idx
  on prospect_generation_runs (status, created_at desc) where status = 'running';

-- Layout audit findings for a generated concept: icon/heading misalignment and
-- off-centre nav, measured in a real browser across several viewport widths.
-- Advisory only — the concept HTML is never rewritten on the basis of it, so a
-- non-empty array means "look at this", not "this was changed".
alter table prospect_mockups add column if not exists layout_findings jsonb;

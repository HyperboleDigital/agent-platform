-- Additive migration — Phase 0 of the SEO-automation plan (docs/plans/
-- seo-automation.md). One row per DataForSEO On-Page crawl audit of a client's
-- site: stores the raw check counts, the SEMrush-style 0-100 onpage_score, and
-- a Haiku-synthesized severity-ranked issue tracker. Distinct from seo_audits
-- (which is per-URL PageSpeed Insights). Superadmin-only beta for now. Safe to run.

create table if not exists seo_crawls (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  url            text not null,                    -- crawl target (bare domain)
  status         text not null default 'running',  -- 'running' | 'finished' | 'failed'
  task_id        text,                             -- DataForSEO On-Page task id
  onpage_score   numeric,                          -- 0-100 overall health (hero metric)
  pages_crawled  integer,
  checks         jsonb,                            -- raw non-zero check counts from DataForSEO
  issues         jsonb,                            -- Haiku-synthesized severity-ranked tracker
  cost           numeric,                          -- DataForSEO spend for this crawl (USD)
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists seo_crawls_client_idx on seo_crawls (client_id, created_at desc);

alter table seo_crawls enable row level security;

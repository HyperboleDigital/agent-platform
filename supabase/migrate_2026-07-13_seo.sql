-- Additive migration for the existing DB — Phase 4 slice 3 (SEO + AI visibility).
-- Safe to run: only adds what's missing, never drops or rewrites existing data.
-- Paste into the Supabase SQL editor.

-- Per-client SEO config: which pages to audit, brand terms for visibility
-- mention-matching, and the connected Google Search Console property (if any).
-- Kept as jsonb on clients rather than new columns — this is soft config, not
-- relational data, and the shape will keep growing across SEO/content slices.
alter table clients add column if not exists portal_config jsonb not null default '{}';

-- One row per PageSpeed Insights run against one URL.
create table if not exists seo_audits (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  url             text not null,
  strategy        text not null default 'mobile', -- 'mobile' | 'desktop'
  scores          jsonb not null,                  -- { performance, seo, accessibility, bestPractices } 0-100
  metrics         jsonb,                            -- core web vitals: LCP, CLS, INP, TBT
  recommendations text,                              -- LLM plain-English summary (markdown)
  created_at      timestamptz not null default now()
);
create index if not exists seo_audits_client_idx on seo_audits (client_id, created_at desc);

-- Daily cache of Google Search Console query performance, so trends survive
-- GSC's data window and dashboard loads don't hit Google live.
create table if not exists gsc_snapshots (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  date       date not null,
  queries    jsonb not null, -- [{ query, clicks, impressions, ctr, position }]
  totals     jsonb not null, -- { clicks, impressions, ctr, position }
  created_at timestamptz not null default now(),
  unique (client_id, date)
);
create index if not exists gsc_snapshots_client_idx on gsc_snapshots (client_id, date desc);

-- Queries a client wants tracked for AI-search (ChatGPT/Claude) visibility.
create table if not exists visibility_queries (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  query      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists visibility_queries_client_idx on visibility_queries (client_id);

-- One row per (query, provider) check run.
create table if not exists visibility_runs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  query_id      uuid not null references visibility_queries(id) on delete cascade,
  provider      text not null, -- 'openai' | 'anthropic'
  model         text,
  mentioned     boolean not null,
  domain_cited  boolean not null default false,
  snippet       text,
  created_at    timestamptz not null default now()
);
create index if not exists visibility_runs_client_idx on visibility_runs (client_id, created_at desc);
create index if not exists visibility_runs_query_idx on visibility_runs (query_id, created_at desc);

alter table seo_audits         enable row level security;
alter table gsc_snapshots      enable row level security;
alter table visibility_queries enable row level security;
alter table visibility_runs    enable row level security;

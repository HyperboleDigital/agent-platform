-- Additive — target-keyword rank tracking. The GSC "Rankings" view only shows
-- what a site ALREADY ranks for (reactive). This is the strategic half: the
-- keywords a client is TRYING to rank for, their current Google organic
-- position, and how it moves over time — the actual "here's where you started,
-- here's your progress" story an SEO retainer is sold on. Positions come from
-- DataForSEO's organic SERP API (same vendor as the on-page crawl), checked
-- on-demand (no scheduler yet — see TODO.md). Safe to run.

-- The managed list: one row per keyword the client wants to rank for.
create table if not exists seo_target_keywords (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  keyword      text not null,
  created_at   timestamptz not null default now(),
  unique (client_id, keyword)
);
create index if not exists seo_target_keywords_client_idx on seo_target_keywords (client_id, created_at);
alter table seo_target_keywords enable row level security;

-- One row per rank check. `rank_absolute` is the client's position in the
-- organic results (null = not found in the results we checked). `keyword` is
-- denormalized so a check's history reads standalone; the FK cascade still
-- clears history when a keyword is removed from the list.
create table if not exists seo_keyword_ranks (
  id            uuid primary key default gen_random_uuid(),
  keyword_id    uuid not null references seo_target_keywords(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  keyword       text not null,
  rank_absolute integer,
  url           text,
  checked_at    timestamptz not null default now()
);
create index if not exists seo_keyword_ranks_client_idx on seo_keyword_ranks (client_id, checked_at);
create index if not exists seo_keyword_ranks_keyword_idx on seo_keyword_ranks (keyword_id, checked_at);
alter table seo_keyword_ranks enable row level security;

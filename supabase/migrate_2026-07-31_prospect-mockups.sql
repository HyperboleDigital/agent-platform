-- Additive — prospecting v2: homepage mockup concepts + a shareable preview
-- page. Extends the existing prospecting engine (lib/prospecting.ts); it does
-- NOT replace or duplicate it, and adds no send path — the operator still
-- sends from their own inbox, so the email guardrails stay out of play.
--
-- What this adds to the existing discovery -> draft -> CSV flow: a generated
-- "here's what your homepage could look like" image, and a tokenized public
-- page the operator can paste into their own email so the prospect has
-- something concrete to open. The audit shown on that page is the EXISTING
-- ad-hoc DataForSEO crawl (seo_crawls with client_id = null) — no second
-- audit engine. Safe to run.

-- One row per generated concept. Regenerating makes a NEW row rather than
-- overwriting, so a preview link keeps showing the image that was actually
-- shared even after the operator iterates. `prompt` is stored for
-- reproducibility; `brand` is what was scraped off their homepage to ground it.
create table if not exists prospect_mockups (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references prospects(id) on delete cascade,
  style_key       text not null default 'modern-service-v1',
  brand           jsonb not null default '{}'::jsonb,  -- extracted name/services/colors/logo
  prompt          text not null,
  direction_notes text,                                 -- operator steer for a regenerate
  storage_path    text not null,                        -- prospect-mockups bucket
  model           text,
  created_at      timestamptz not null default now()
);
create index if not exists prospect_mockups_prospect_idx
  on prospect_mockups (prospect_id, created_at desc);

-- The page a prospect opens. They have no login, so preview_token (192 bits,
-- base64url) is the only credential — treat the page as public and put nothing
-- on it beyond the mockup, the audit summary, and a CTA. revoked_at kills a
-- link without deleting the history of what was shared. crawl_id points at the
-- existing ad-hoc seo_crawls row so the page shows the real audit.
create table if not exists prospect_previews (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references prospects(id) on delete cascade,
  mockup_id       uuid references prospect_mockups(id) on delete set null,
  crawl_id        uuid references seo_crawls(id) on delete set null,
  preview_token   text not null,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  view_count      integer not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists prospect_previews_token_key
  on prospect_previews (preview_token);
create index if not exists prospect_previews_prospect_idx
  on prospect_previews (prospect_id, created_at desc);

alter table prospect_mockups  enable row level security;
alter table prospect_previews enable row level security;

-- Private bucket for the generated PNGs — same convention as
-- request-attachments / knowledge-files. NOT public: a public bucket URL is
-- permanent and unrevokable, and a *.supabase.co link reads as phishing in a
-- cold email. Bytes are served through GET /p/:token/image instead, which is
-- revocable and view-tracked.
insert into storage.buckets (id, name, public)
values ('prospect-mockups', 'prospect-mockups', false)
on conflict (id) do nothing;

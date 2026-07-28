-- Agent Platform — Supabase schema
-- Paste into the Supabase SQL editor (or run via `supabase db push`).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists vector;        -- pgvector, for knowledge_base.embedding

-- ── clients ──────────────────────────────────────────────────────────────────
create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  domain        text,
  industry      text,
  active        boolean not null default true,
  agent_config  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  -- Clerk Organization that owns this client — the tenant boundary. Null until
  -- a client is onboarded into Clerk (superadmin-only access until then).
  clerk_org_id  text unique,
  -- SEO/portal soft config (audit pages, brand terms, connected GSC property).
  -- jsonb rather than columns since this shape keeps growing across slices.
  portal_config jsonb not null default '{}'::jsonb,
  -- Finalized pricing-sheet tier assignment. No FK — the tier catalog is
  -- code-defined in lib/tiers.ts (same pattern as billing.ts's PLANS), not a
  -- DB table, since Owen is still iterating on the sheet.
  vertical      text check (vertical in ('local', 'b2b')),
  tier_key      text
);

-- ── knowledge_base ───────────────────────────────────────────────────────────
-- content is chunked at ingestion (see apps/tools + tools/knowledge-base.ts).
-- embedding is voyage-3-lite (1024-dim); nullable so full-text still works
-- before a backfill runs.
create table if not exists knowledge_base (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  title      text not null,
  content    text not null,
  url        text,
  embedding  vector(1024),
  created_at timestamptz not null default now()
);

-- Full-text search index over content (used by searchDocs textSearch fallback).
create index if not exists knowledge_base_content_fts
  on knowledge_base using gin (to_tsvector('english', content));

create index if not exists knowledge_base_client_idx
  on knowledge_base (client_id);

-- Approximate nearest-neighbour index for vector search.
create index if not exists knowledge_base_embedding_idx
  on knowledge_base using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Original bytes of an uploaded knowledge-base file (knowledge_base above only
-- keeps extracted/chunked text) — lets the dashboard show a preview thumbnail.
-- Bytes live in the 'knowledge-files' Storage bucket, see the insert below.
create table if not exists knowledge_files (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  filename     text not null,
  content_type text not null,
  size_bytes   integer not null,
  storage_path text not null,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists knowledge_files_client_idx on knowledge_files (client_id, created_at desc);

-- Groups knowledge_base chunk rows into one document (a single upload/paste
-- can span several chunk rows) so the dashboard can list/delete/replace a
-- whole document as one unit instead of chunk-by-chunk. file_id links a
-- document's chunks back to its original file (null for pasted-text docs).
-- Added bare + backfilled + constrained after, rather than in one shot, to
-- avoid forcing a full table rewrite (a volatile default can't use the fast-
-- default optimization, and rewriting means rebuilding every index on the
-- table too — including the ivfflat vector index, which is memory-heavy).
alter table knowledge_base add column if not exists document_id uuid;
alter table knowledge_base add column if not exists file_id uuid references knowledge_files(id) on delete set null;
alter table knowledge_base add column if not exists description text;
update knowledge_base set document_id = gen_random_uuid() where document_id is null;
alter table knowledge_base alter column document_id set not null;
alter table knowledge_base alter column document_id set default gen_random_uuid();
create index if not exists knowledge_base_document_idx on knowledge_base (document_id);

-- ── leads ────────────────────────────────────────────────────────────────────
create table if not exists leads (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  name       text,
  email      text not null,
  intent     text,
  summary    text,
  channel    text not null default 'chat',
  status     text not null default 'new', -- 'new' | 'followed_up'
  created_at timestamptz not null default now()
);
create index if not exists leads_client_idx on leads (client_id);

-- ── escalations ──────────────────────────────────────────────────────────────
create table if not exists escalations (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  from_email text not null,
  body       text,
  reason     text,
  status     text not null default 'open',   -- 'open' | 'resolved'
  created_at timestamptz not null default now()
);
create index if not exists escalations_client_idx on escalations (client_id);

-- ── message_logs ─────────────────────────────────────────────────────────────
create table if not exists message_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  channel     text not null,                  -- 'chat' | 'email'
  intent      text,
  resolved    boolean not null default false,
  duration_ms integer,
  created_at  timestamptz not null default now()
);
create index if not exists message_logs_client_idx on message_logs (client_id);
create index if not exists message_logs_created_idx on message_logs (created_at);
create index if not exists message_logs_client_created_idx on message_logs (client_id, created_at desc);

-- ── gmail_tokens ─────────────────────────────────────────────────────────────
-- Per-client Gmail OAuth refresh tokens (Phase 4 — replaces the n8n dependency).
create table if not exists gmail_tokens (
  client_id     uuid primary key references clients(id) on delete cascade,
  email         text not null,
  refresh_token text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── match_knowledge RPC ──────────────────────────────────────────────────────
-- Cosine-similarity search over knowledge_base embeddings, scoped to a client.
-- Called from tools/knowledge-base.ts when VOYAGE_API_KEY is configured.
create or replace function match_knowledge(
  query_embedding vector(1024),
  match_client_id uuid,
  match_count int default 3
)
returns table (
  id         uuid,
  title      text,
  content    text,
  url        text,
  similarity float
)
language sql stable
as $$
  select
    kb.id,
    kb.title,
    kb.content,
    kb.url,
    1 - (kb.embedding <=> query_embedding) as similarity
  from knowledge_base kb
  where kb.client_id = match_client_id
    and kb.embedding is not null
  order by kb.embedding <=> query_embedding
  limit match_count;
$$;

-- ── subscriptions ────────────────────────────────────────────────────────────
-- One row per client. We store the Stripe price ID rather than a hardcoded
-- "plan" enum — plan metadata (name, conversation cap) is resolved from a
-- code-level config keyed by price ID (lib/billing.ts), so adding tiers,
-- repricing, or adding a metered component to a plan later is a config
-- change, not a schema migration. A subscription's `stripe_subscription_id`
-- covers the whole Stripe subscription regardless of how many line items it
-- has, so future hybrid (flat + metered) pricing needs no new columns here.
create table if not exists subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null unique references clients(id) on delete cascade,
  stripe_customer_id    text not null,
  stripe_subscription_id text unique,
  stripe_price_id       text,
  status                text not null default 'incomplete', -- Stripe subscription status
  current_period_end    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on subscriptions (stripe_customer_id);
create index if not exists subscriptions_stripe_sub_idx on subscriptions (stripe_subscription_id);

-- ── subscription_items ───────────────────────────────────────────────────────
-- Mirror of ALL line items on a client's Stripe subscription (base plan + any
-- add-on services). subscriptions.stripe_price_id keeps meaning "the base plan
-- item"; add-on service entitlements resolve from the rows here whose price ID
-- maps to a SERVICES entry (lib/services.ts). Kept in sync by the subscription
-- webhook (lib/billing.ts syncSubscriptionFromStripe).
create table if not exists subscription_items (
  id                              uuid primary key default gen_random_uuid(),
  client_id                       uuid not null references clients(id) on delete cascade,
  stripe_subscription_item_id     text not null unique,
  stripe_price_id                 text not null,
  quantity                        int not null default 1,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create index if not exists subscription_items_client_idx on subscription_items (client_id);

-- ── service_grants ───────────────────────────────────────────────────────────
-- Superadmin-granted service access without a Stripe purchase (comps, internal
-- test clients). Soft-revoked via revoked_at so grants keep an audit trail; a
-- unique (client_id, service_key) means re-granting updates the same row.
create table if not exists service_grants (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  service_key text not null,
  source      text not null default 'comp',
  granted_by  text,                                 -- clerk user id of the superadmin
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (client_id, service_key)
);
create index if not exists service_grants_client_idx on service_grants (client_id);

-- ── seo_audits ────────────────────────────────────────────────────────────────
-- One row per PageSpeed Insights run against one URL (the `seo` add-on service).
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

-- ── site_health_checks ────────────────────────────────────────────────────────
-- On-demand "Site Health" checks (Care tier: uptime + SSL) for every client,
-- regardless of add-on services. One row per check, most-recent read by the
-- dashboard; no scheduler — always triggered by a live page load or an
-- explicit "Check now" click (see lib/site-health.ts).
create table if not exists site_health_checks (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  checked_at        timestamptz not null default now(),
  up                boolean not null,
  status_code       integer,
  response_time_ms  integer,
  error             text,               -- set when `up` is false (fetch failed) — timeout, DNS, refused, etc.
  ssl_valid         boolean,            -- null when the site isn't served over https at all
  ssl_issuer        text,
  ssl_expires_at    timestamptz,
  ssl_days_remaining integer
);
create index if not exists site_health_checks_client_idx on site_health_checks (client_id, checked_at desc);
alter table site_health_checks enable row level security;

-- ── citations / gbp_activity ──────────────────────────────────────────────────
-- "Local Presence" (Offer Sheet A, Tier 2). Both are maintained BY HAND for
-- now — the Google Business Profile API needs Google-approved access, and
-- citation building is submission work done manually anyway. These are what
-- the client sees proving the work happened; a later API integration would
-- populate the same shape automatically.
create table if not exists citations (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  directory    text not null,                     -- "Yelp", "Better Business Bureau", …
  listing_url  text,
  status       text not null default 'pending',   -- 'pending' | 'live' | 'inconsistent' | 'not_applicable'
  nap_name     text,                              -- name/address/phone AS LISTED on that directory
  nap_address  text,
  nap_phone    text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, directory)
);
create index if not exists citations_client_idx on citations (client_id, directory);

create table if not exists gbp_activity (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  kind         text not null,                     -- 'post' | 'photo' | 'qa' | 'category' | 'other'
  title        text not null,
  url          text,
  performed_at date not null default current_date,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists gbp_activity_client_idx on gbp_activity (client_id, performed_at desc);

-- ── gsc_snapshots ─────────────────────────────────────────────────────────────
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

-- ── visibility_queries / visibility_runs ────────────────────────────────────
-- AI-search (ChatGPT/Claude) brand-mention tracking, also part of the `seo`
-- add-on service.
create table if not exists visibility_queries (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  query      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists visibility_queries_client_idx on visibility_queries (client_id);

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

-- ── change_requests ──────────────────────────────────────────────────────────
create table if not exists change_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  title        text not null,
  description  text not null default '',
  status       text not null default 'open', -- open | in_progress | done | declined | cancelled
  created_by   text,                          -- clerk user id
  cancel_reason text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists change_requests_client_idx on change_requests (client_id, created_at desc);
create index if not exists change_requests_status_idx on change_requests (status);

-- Append-only status-change audit trail, one row per transition (including
-- the initial creation and client-initiated cancels).
create table if not exists change_request_events (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references change_requests(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  changed_by   text,        -- clerk user id, or 'system'
  note         text,        -- e.g. cancel reason
  created_at   timestamptz not null default now()
);
create index if not exists change_request_events_request_idx on change_request_events (request_id, created_at);

-- Comment thread on a request — either party (client or superadmin) can post.
create table if not exists change_request_comments (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references change_requests(id) on delete cascade,
  author_id     text not null,
  is_superadmin boolean not null default false,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists change_request_comments_request_idx on change_request_comments (request_id, created_at);

-- File metadata only — bytes live in the 'request-attachments' Storage
-- bucket (see storage.buckets insert below), accessed via short-lived signed
-- URLs the API mints on demand.
create table if not exists change_request_attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references change_requests(id) on delete cascade,
  filename     text not null,
  content_type text not null,
  size_bytes   integer not null,
  storage_path text not null,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists change_request_attachments_request_idx on change_request_attachments (request_id, created_at);

-- ── notification_settings ────────────────────────────────────────────────────
-- One row per client. Per-event toggles for which channels fire on which
-- events — jsonb rather than columns since the event set will keep growing.
create table if not exists notification_settings (
  client_id         uuid primary key references clients(id) on delete cascade,
  email_enabled     boolean not null default false,
  email_to          text,
  slack_enabled     boolean not null default false,
  slack_webhook_url text,
  events            jsonb not null default '{}',
  updated_at        timestamptz not null default now()
);

-- ── blog_posts ───────────────────────────────────────────────────────────────
-- The `content` add-on service: AI-drafted, keyword-targeted posts with a
-- review/approve/publish lifecycle (transitions validated in lib/content.ts).
create table if not exists blog_posts (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  brief            text not null,
  target_keyword   text not null,
  title            text,
  slug             text,
  meta_description text,
  content_md       text,
  status           text not null default 'draft', -- draft | in_review | approved | published | archived
  model            text,
  framer_item_id   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz
);
create index if not exists blog_posts_client_idx on blog_posts (client_id, created_at desc);

-- ── framer_connections ───────────────────────────────────────────────────────
-- Per-client Framer Server API connection for publishing. API key encrypted
-- at rest with lib/crypto.ts, same as gmail_tokens.
create table if not exists framer_connections (
  client_id     uuid primary key references clients(id) on delete cascade,
  project_url   text not null, -- e.g. https://framer.com/projects/Website--aabbccdd1122
  api_key_enc   text not null,
  collection_id text not null,
  field_mapping jsonb not null default '{}', -- { title: fieldId, body: fieldId, slug: fieldId, metaDescription: fieldId }
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── reports ──────────────────────────────────────────────────────────────────
-- A persisted metrics SNAPSHOT (data jsonb) so historical reports don't drift.
-- sent_at/sent_to record the one manual send (email is never auto/scheduled —
-- see lib/reports.ts + lib/notify.ts guardrails).
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

-- ── notification_log ─────────────────────────────────────────────────────────
-- Audit trail + daily-cap enforcement for platform-sent emails (lib/notify.ts).
-- Persisted rather than an in-memory counter — a process restart must not
-- reset the cap. One row per actual send attempt.
create table if not exists notification_log (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete cascade,
  event      text not null,
  channel    text not null, -- 'email' | 'slack'
  recipient  text,
  created_at timestamptz not null default now()
);
create index if not exists notification_log_channel_created_idx on notification_log (channel, created_at);

-- ── Row-level security (defense-in-depth) ────────────────────────────────────
-- The API exclusively uses the Supabase service_role key, which bypasses RLS
-- entirely — this does NOT change app behavior. It exists so that a leaked
-- anon/publishable key, a future client-side Supabase usage, or a bug that
-- routes a request through a lower-privilege key CANNOT read/write tenant
-- data. Deny-by-default: no policies are defined, so anon/authenticated roles
-- get zero access to any row unless a policy is explicitly added later.
alter table clients        enable row level security;
alter table knowledge_base enable row level security;
alter table knowledge_files enable row level security;
alter table leads          enable row level security;
alter table escalations    enable row level security;
alter table message_logs   enable row level security;
alter table gmail_tokens   enable row level security;
alter table subscriptions  enable row level security;
alter table subscription_items enable row level security;
alter table service_grants     enable row level security;
alter table seo_audits         enable row level security;
alter table gsc_snapshots      enable row level security;
alter table visibility_queries enable row level security;
alter table visibility_runs    enable row level security;
alter table change_requests    enable row level security;
alter table change_request_events      enable row level security;
alter table change_request_comments    enable row level security;
alter table change_request_attachments enable row level security;
alter table notification_settings enable row level security;
alter table notification_log   enable row level security;
alter table blog_posts         enable row level security;
alter table framer_connections enable row level security;
alter table reports            enable row level security;
alter table citations          enable row level security;
alter table gbp_activity       enable row level security;

-- Private bucket for change-request attachments — the API is the only thing
-- that touches it, always via short-lived signed URLs it mints itself
-- (service-role key bypasses RLS, same convention as every table above).
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;

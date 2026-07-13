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
  portal_config jsonb not null default '{}'::jsonb
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

-- ── leads ────────────────────────────────────────────────────────────────────
create table if not exists leads (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  name       text,
  email      text not null,
  intent     text,
  summary    text,
  channel    text not null default 'chat',
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
  status       text not null default 'open', -- open | in_progress | done | declined
  created_by   text,                          -- clerk user id
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists change_requests_client_idx on change_requests (client_id, created_at desc);
create index if not exists change_requests_status_idx on change_requests (status);

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
alter table notification_settings enable row level security;
alter table notification_log   enable row level security;
alter table blog_posts         enable row level security;
alter table framer_connections enable row level security;

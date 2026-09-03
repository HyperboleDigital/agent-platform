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
  -- Chat widget appearance (title, colours, teaser prompts, in-panel chips).
  -- Fetched by the widget at load via the PUBLIC /widget-config/:clientId, so
  -- everything in here is world-readable — no secrets. Empty {} renders the
  -- widget's built-in defaults.
  widget_config jsonb not null default '{}'::jsonb,
  -- Pricing-sheet tier assignment ('care' | 'seo' | 'growth'). No FK — the
  -- tier catalog is code-defined in lib/tiers.ts (same pattern as
  -- services.ts's CATALOG), not a DB table.
  -- `vertical` is NO LONGER a pricing dimension (the Local/B2B tier split was
  -- collapsed 2026-08-18) — kept only as a harmless segmentation tag.
  vertical      text check (vertical in ('local', 'b2b')),
  tier_key      text,
  -- Who owns the platform the client's site runs on. 'us' = we host (default
  -- post-launch path → Care retainer; hosting bullet + Site Health apply).
  -- 'client' = client-owned infra (e.g. Squarespace) → default retainer is
  -- the chatbot; hosting promises and Site Health are suppressed.
  hosting       text check (hosting in ('us', 'client')) default 'us'
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
  created_at timestamptz not null default now(),
  -- The chat session that captured this lead (migrate_2026-08-08_chat-analytics.sql).
  -- Null for contact-form and pre-migration leads.
  session_id text
);
create index if not exists leads_client_idx on leads (client_id);
create index if not exists leads_session_idx on leads (client_id, session_id);

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
  created_at  timestamptz not null default now(),
  -- Conversation-level instrumentation (migrate_2026-08-08_chat-analytics.sql).
  -- See that migration for the full rationale; kept in sync here since this file
  -- is the canonical, re-runnable schema.
  session_id        text,                     -- widget `from` (one per page visit)
  user_message      text,
  assistant_response text,
  confidence        real,                     -- real top KB-match cosine similarity (0..1)
  escalated         boolean not null default false,
  escalation_reason text,
  resolved_by       text check (resolved_by in ('agent', 'human', 'abandoned')),
  tools_used        text[] not null default '{}',
  retrieved_doc_ids uuid[] not null default '{}',
  query_embedding   vector(1024),
  -- LLM cost instrumentation (migrate_2026-09-03_chat-cost.sql): which model
  -- answered, token spend, and cost in millionths of a USD — feeds the
  -- superadmin AI-spend overview.
  model             text,
  input_tokens      integer,
  output_tokens     integer,
  cost_micros       bigint
);
create index if not exists message_logs_client_idx on message_logs (client_id);
create index if not exists message_logs_created_idx on message_logs (created_at);
create index if not exists message_logs_client_created_idx on message_logs (client_id, created_at desc);
create index if not exists message_logs_session_idx on message_logs (client_id, session_id, created_at);
create index if not exists message_logs_escalated_idx on message_logs (client_id, created_at desc) where escalated;

-- Conversation-level metrics, derived from message_logs (+ leads). See
-- migrate_2026-08-08_chat-analytics.sql for outcome precedence. Every row
-- carries client_id — callers MUST still filter on it (the analytics lib does).
create or replace view chat_sessions as
with per_session as (
  select
    m.client_id,
    m.session_id,
    min(m.created_at)                    as started_at,
    max(m.created_at)                    as ended_at,
    count(*)                             as message_count,
    bool_or(m.escalated)                 as escalated,
    bool_or(coalesce(m.resolved, false)) as any_resolved
  from message_logs m
  where m.session_id is not null
  group by m.client_id, m.session_id
)
select
  s.client_id, s.session_id, s.started_at, s.ended_at, s.message_count, s.escalated,
  exists (select 1 from leads l where l.client_id = s.client_id and l.session_id = s.session_id) as lead_captured,
  case
    when exists (select 1 from leads l where l.client_id = s.client_id and l.session_id = s.session_id) then 'lead'
    when s.escalated then 'escalated'
    when s.any_resolved then 'resolved'
    else 'abandoned'
  end as outcome
from per_session s;

-- ── gmail_tokens ─────────────────────────────────────────────────────────────
-- Per-client Gmail OAuth refresh tokens (Phase 4 — replaces the n8n dependency).
create table if not exists gmail_tokens (
  client_id     uuid primary key references clients(id) on delete cascade,
  email         text not null,
  refresh_token text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── platform_gmail_token ─────────────────────────────────────────────────────
-- The platform's OWN Gmail sender — independent of any client record. Powers
-- ALL platform-sent email (Clerk-relayed system emails, reports,
-- change-request notifications) via lib/notify.ts's sendGuardedEmail.
-- Connected by a superadmin from Overview (not tied to onboarding/deleting
-- any client). Singleton: the `boolean` PK + check allows exactly one row.
create table if not exists platform_gmail_token (
  id            boolean primary key default true check (id),
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

-- ── client_line_items ────────────────────────────────────────────────────────
-- Per-deal custom line items: a client's billing is a tier TEMPLATE plus these
-- (add/remove/re-price/comp anything for a specific client). Billing and
-- presentation ONLY — never an entitlement source; access grants stay in
-- service_grants. See lib/line-items.ts.
create table if not exists client_line_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  label text not null,
  description text,
  amount_cents integer not null,
  cadence text not null check (cadence in ('monthly', 'one_time')),
  -- 'included' = shown on the info sheet at $0 as a deal sweetener.
  -- Keep amount_cents at its real value and let this flag zero it at billing
  -- time, so we can always see what we gave away.
  included boolean not null default false,
  stripe_price_id text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists client_line_items_client_idx on client_line_items(client_id, sort_order);

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

-- ── prospects ─────────────────────────────────────────────────────────────────
-- Cold-outreach prospecting engine (admin/superadmin tool). Finds local
-- businesses via Google Places, stores personalized outreach drafts, and hands
-- the operator a list they send themselves. The platform never sends email
-- here — no send path, no scheduler. `place_id` dedupes across searches; a null
-- `website` marks a prime "we'll build you one" target; `email` is manual.
create table if not exists prospects (
  id            uuid primary key default gen_random_uuid(),
  place_id      text unique,
  name          text not null,
  category      text,          -- raw Places search term, a record of HOW it was found
  group_name    text,          -- operator's editable organizing label ("Roofers")
  area          text,
  phone         text,
  email         text,
  website       text,
  maps_url      text,
  rating        numeric,
  review_count  integer,
  status        text not null default 'new',  -- new|saved|drafted|sent|replied|won|lost|do_not_contact
  draft_plain   text,
  draft_loom    text,
  draft_value   text,  -- fuller value-prop email (mockup + audit + chat assistant + book-a-call)
  hook_source   text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists prospects_status_idx on prospects (status, created_at);
create index if not exists prospects_area_idx on prospects (area, category);
create index if not exists prospects_group_idx on prospects (group_name, status, created_at desc);

-- ── design_references ────────────────────────────────────────────────────────
-- The operator's inspo library — uploaded images (Figma comps, Dribbble shots,
-- screenshots of sites they like) that steer concept generation. This is the
-- ONLY mechanism directing design, deliberately: the operator's taste governs,
-- not the model's. With an empty library, generation has nothing to imitate.
--
-- `vertical` is a coarse tag (trades, medical, hospitality, ...). NULL means
-- "applies to any business" and acts as the fallback pool when a prospect's
-- vertical has no references of its own. `notes` is fed to the model verbatim.
-- Operator-named collections of design inspo (see design_references below).
-- Chosen explicitly per prospect at mockup-generation time — see prospect_mockups.
create table if not exists design_libraries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);
create unique index if not exists design_libraries_name_lower_idx on design_libraries (lower(name));

create table if not exists design_references (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  -- Deprecated — superseded by library_id (migrate_2026-08-08b_design-libraries.sql).
  -- No longer read or written; kept rather than dropped (migrations here are additive-only).
  vertical      text,
  library_id    uuid references design_libraries(id) on delete set null,
  notes         text,
  storage_path  text not null,                 -- design-inspo bucket
  content_type  text not null,
  size_bytes    integer,
  active        boolean not null default true, -- retire without losing provenance
  created_at    timestamptz not null default now()
);
create index if not exists design_references_library_idx on design_references (library_id, active);
create index if not exists design_references_active_idx
  on design_references (active, vertical, created_at desc);

-- ── prospect_mockups / prospect_previews ─────────────────────────────────────
-- Prospecting: a "here's what your homepage could look like" concept, plus a
-- tokenized public page the operator pastes into their own email. Still no
-- send path — the operator sends it themselves. The audit shown on the preview
-- page is the EXISTING ad-hoc DataForSEO crawl (seo_crawls with
-- client_id = null), not a second audit engine.
-- Regenerating makes a NEW mockup row rather than overwriting, so an already-
-- shared preview keeps showing what was actually sent.
--
-- format='html' (current) stores a full generated page in `html`. format='image'
-- is the standalone generated-image path — a single PNG in `storage_path`.
-- `model` records which image model drew it. Rows from before 2026-08-10 used
-- gpt-image-1 on a 1536x1024 landscape canvas and could only ever depict a
-- fold; they keep rendering as sent.
--
-- An html row may also carry `layout_image_path`: the full-page image the
-- concept was drawn from under the layout-first flow. Internal only.
create table if not exists prospect_mockups (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references prospects(id) on delete cascade,
  style_key       text not null default 'modern-service-v1',
  brand           jsonb not null default '{}'::jsonb,  -- extracted name/services/colors/logo
  prompt          text not null,
  direction_notes text,
  storage_path    text,                                 -- prospect-mockups bucket; image format only
  html            text,                                 -- the generated page; html format only
  -- prospect-mockups bucket: the layout-first draft image this html concept was
  -- built from, if any. Deliberately NOT storage_path — the routes that serve a
  -- concept as an image key off storage_path, and this draft is an internal
  -- reference the prospect must never be served.
  layout_image_path text,
  -- Layout audit findings (icon/heading alignment, nav centring), measured in a
  -- real browser at several widths. Advisory: the HTML is never rewritten from
  -- it, so a non-empty array means "look at this", not "this was changed".
  layout_findings jsonb,
  format          text not null default 'image' check (format in ('image', 'html')),
  current_screenshot_path text,                         -- prospect-screenshots: their site today
  reference_ids   uuid[],                               -- design_references that steered this
  library_id      uuid references design_libraries(id) on delete set null, -- which library was chosen for this generation, if any
  model           text,
  created_at      timestamptz not null default now()
);
create index if not exists prospect_mockups_prospect_idx
  on prospect_mockups (prospect_id, created_at desc);

-- A one-click concept generation run: the multi-step, multi-provider job
-- (scrape -> analysis -> layout image -> stock photos -> HTML -> audit) that
-- the wizard drives. Progress and cost are written here as the job proceeds
-- and polled by the dashboard, following seo_crawls' background-job shape
-- rather than holding a ~3 minute HTTP request open. See
-- migrate_2026-08-10b_generation-runs.sql for the full rationale.
create table if not exists prospect_generation_runs (
  id            uuid primary key default gen_random_uuid(),
  prospect_id   uuid not null references prospects(id) on delete cascade,
  status        text not null default 'running' check (status in ('running', 'done', 'error')),
  steps         jsonb not null default '[]'::jsonb,   -- [{ key, label, status, pct, detail }]
  current_step  text,
  mockup_id     uuid references prospect_mockups(id) on delete set null,
  cost_micros   bigint not null default 0,            -- millionths of a USD; see migration
  cost_detail   jsonb not null default '[]'::jsonb,
  options       jsonb not null default '{}'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists prospect_generation_runs_prospect_idx
  on prospect_generation_runs (prospect_id, created_at desc);
create index if not exists prospect_generation_runs_running_idx
  on prospect_generation_runs (status, created_at desc) where status = 'running';

-- preview_token (192 bits, base64url) is the ONLY credential — the prospect
-- has no login, so treat this page as public. revoked_at kills a link without
-- deleting the record of what was shared.
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

-- ── ads_snapshots ─────────────────────────────────────────────────────────────
-- Daily cache of a client's Google Ads (PPC) performance for the Paid Ads
-- dashboard section + monthly fee reconciliation. Read-only pull via Hyperbole's
-- manager (MCC) access; the client pays Google directly. Mirrors gsc_snapshots.
create table if not exists ads_snapshots (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  date       date not null,
  totals     jsonb not null, -- { spendCents, impressions, clicks, conversions, conversionsValue, costPerLeadCents, avgCpcCents }
  campaigns  jsonb not null, -- [{ id, name, status, spendCents, impressions, clicks, conversions }]
  created_at timestamptz not null default now(),
  unique (client_id, date)
);
create index if not exists ads_snapshots_client_idx on ads_snapshots (client_id, date desc);

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

-- ── Care tier: technical baseline + automated monthly report ─────────────────
create table if not exists site_baselines (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  url          text not null,
  mobile_score integer,
  checks       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists site_baselines_client_idx on site_baselines (client_id, created_at desc);

-- The unique index below is a SAFETY mechanism, not bookkeeping. Report email
-- is scheduler-driven, which this codebase otherwise forbids after an incident
-- where 582 emails were auto-sent from an unbounded loop. The sender claims a
-- period by inserting here FIRST and only sends if the insert won, so a double
-- send for the same client and month is impossible at the database level.
-- See apps/api/src/lib/report-scheduler.ts.
create table if not exists report_deliveries (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  period_key text not null, -- 'YYYY-MM'
  report_id  uuid references reports(id) on delete set null,
  status     text not null default 'sent',
  recipient  text,
  detail     text,
  created_at timestamptz not null default now()
);
create unique index if not exists report_deliveries_once_idx on report_deliveries (client_id, period_key);

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
alter table prospects          enable row level security;
alter table prospect_mockups   enable row level security;
alter table prospect_previews  enable row level security;
alter table design_references  enable row level security;
alter table ads_snapshots      enable row level security;

-- Private bucket for change-request attachments — the API is the only thing
-- that touches it, always via short-lived signed URLs it mints itself
-- (service-role key bypasses RLS, same convention as every table above).
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;

-- Generated prospect mockup PNGs. NOT public — a public bucket URL is
-- permanent and unrevokable, and a *.supabase.co link reads as phishing in a
-- cold email. Served via GET /p/:token/image instead (revocable, view-tracked).
insert into storage.buckets (id, name, public)
values ('prospect-mockups', 'prospect-mockups', false)
on conflict (id) do nothing;

-- Uploaded chat-widget logos. Private in Supabase, but the bytes ARE served
-- publicly via GET /widget-config/:clientId/logo — an API route on our own
-- origin, since a signed URL would expire while the widget is still live on a
-- client's site.
insert into storage.buckets (id, name, public)
values ('widget-logos', 'widget-logos', false)
on conflict (id) do nothing;

-- The operator's uploaded design inspiration. Private — these may be licensed
-- or third-party work and must never be publicly addressable.
insert into storage.buckets (id, name, public)
values ('design-inspo', 'design-inspo', false)
on conflict (id) do nothing;

-- Screenshots of prospects' current sites, for the before/after comparison.
insert into storage.buckets (id, name, public)
values ('prospect-screenshots', 'prospect-screenshots', false)
on conflict (id) do nothing;

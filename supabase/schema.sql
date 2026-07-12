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
  clerk_org_id  text unique
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

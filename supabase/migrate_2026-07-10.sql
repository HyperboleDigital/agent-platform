-- Additive migration for an existing DB (tables already created from earlier work).
-- Safe to run: only adds what's missing, never drops or rewrites existing data.
-- Paste into the Supabase SQL editor.

create extension if not exists vector;

-- escalations was missing the "from" column
alter table escalations add column if not exists "from" text;

-- knowledge_base needs the embedding column for vector search (Phase 3)
alter table knowledge_base add column if not exists embedding vector(1024);

create index if not exists knowledge_base_content_fts
  on knowledge_base using gin (to_tsvector('english', content));

create index if not exists knowledge_base_client_idx
  on knowledge_base (client_id);

create index if not exists knowledge_base_embedding_idx
  on knowledge_base using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- gmail_tokens is new (Phase 4 — Gmail OAuth, replaces n8n)
create table if not exists gmail_tokens (
  client_id     uuid primary key references clients(id) on delete cascade,
  email         text not null,
  refresh_token text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- match_knowledge RPC used by tools/knowledge-base.ts when VOYAGE_API_KEY is set
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

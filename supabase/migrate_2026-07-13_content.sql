-- Additive migration for the existing DB — Phase 4 slice 5 (blog content engine).
-- Safe to run: only adds what's missing, never drops or rewrites existing data.
-- Paste into the Supabase SQL editor.

create table if not exists blog_posts (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  brief            text not null,
  target_keyword   text not null,
  title            text,
  slug             text,
  meta_description text,
  content_md       text,
  -- Draft lifecycle. Transitions are validated in code (lib/content.ts):
  -- draft -> in_review -> approved -> published -> archived, with rework
  -- paths back to draft. `published` additionally requires framer_item_id
  -- or an export having happened — enforced in code, not schema.
  status           text not null default 'draft',
  model            text,
  framer_item_id   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz
);
create index if not exists blog_posts_client_idx on blog_posts (client_id, created_at desc);

-- Per-client Framer Server API connection for publishing. API key encrypted
-- at rest with lib/crypto.ts, same as gmail_tokens.
create table if not exists framer_connections (
  client_id     uuid primary key references clients(id) on delete cascade,
  api_key_enc   text not null,
  collection_id text not null,
  field_mapping jsonb not null default '{}', -- { title: fieldId, body: fieldId, slug: fieldId, metaDescription: fieldId }
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table blog_posts         enable row level security;
alter table framer_connections enable row level security;

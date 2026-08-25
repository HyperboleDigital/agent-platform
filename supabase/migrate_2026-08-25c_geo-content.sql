-- GEO engines + chatbot-questions→content pipeline (handoff #3 §4).
-- Safe to run; idempotent; additive only.

-- §4a: who IS being cited when we aren't — the competitor-capture input.
-- Populated by lib/visibility.ts from Perplexity's native citation list and
-- AI-Overview references (and left null for providers that don't return one).
alter table visibility_runs add column if not exists cited_domains text[];

-- §4b: real customer questions the chatbot couldn't answer — the GEO content
-- differentiator. Rows are upserted by the orchestrator's low-confidence
-- fallback path (one row per client × normalized question, count bumped on
-- repeats) and seeded from historical message_logs by the content_brief job's
-- first run. status: 'open' → 'briefed' (a brief exists) → 'answered' (the
-- post published + fed back to the chatbot KB).
create table if not exists chat_unanswered_questions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  question text not null,          -- the raw question as first asked
  normalized text not null,        -- lowercased/stripped for de-duping
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create unique index if not exists chat_unanswered_client_norm_idx
  on chat_unanswered_questions (client_id, normalized);
create index if not exists chat_unanswered_client_status_idx
  on chat_unanswered_questions (client_id, status, count desc);
alter table chat_unanswered_questions enable row level security;

-- §4b: monthly content BRIEFS (not drafts): title + keyword + the customer
-- question answered + outline + internal links. "Draft this" hands a brief
-- into the existing lib/content.ts draft→review→publish flow.
create table if not exists content_briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  question_id uuid references chat_unanswered_questions(id) on delete set null,
  title text not null,
  target_keyword text not null,
  question text,                   -- the customer question this answers (null = keyword-sourced)
  outline jsonb not null default '[]'::jsonb,   -- string[] of section headings
  internal_links text[] not null default '{}',  -- existing pages to link to
  status text not null default 'open',          -- 'open' | 'drafted' | 'archived'
  post_id uuid references blog_posts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists content_briefs_client_idx
  on content_briefs (client_id, created_at desc);
alter table content_briefs enable row level security;

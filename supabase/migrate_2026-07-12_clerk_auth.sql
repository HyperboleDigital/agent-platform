-- Additive migration for the existing DB — Phase 1 security foundation
-- (Clerk auth tenant boundary + RLS defense-in-depth). Safe to run: only adds
-- what's missing, never drops or rewrites existing data.
-- Paste into the Supabase SQL editor.

-- Tenant boundary: each client maps to exactly one Clerk Organization.
alter table clients add column if not exists clerk_org_id text;
create unique index if not exists clients_clerk_org_id_idx on clients (clerk_org_id) where clerk_org_id is not null;

-- Row-level security, deny-by-default. The API uses the service_role key
-- exclusively and is unaffected (service_role bypasses RLS) — this only
-- blocks anon/authenticated-key access paths that shouldn't exist.
alter table clients        enable row level security;
alter table knowledge_base enable row level security;
alter table leads          enable row level security;
alter table escalations    enable row level security;
alter table message_logs   enable row level security;
alter table gmail_tokens   enable row level security;

-- Additive migration for the existing DB — requests upgrade (history, comments,
-- attachments, client-initiated cancel) + a missing composite index that was
-- causing slow client Home stats. Safe to run: only adds what's missing,
-- never drops or rewrites existing data. Paste into the Supabase SQL editor.

-- message_logs had only independent single-column indexes on client_id and
-- created_at — every stats query filters on both together, which can't use
-- either efficiently. Add the composite index other per-client tables
-- (change_requests, seo_audits) already use.
create index if not exists message_logs_client_created_idx on message_logs (client_id, created_at desc);

alter table change_requests add column if not exists cancel_reason text;
-- status values now: open | in_progress | done | declined | cancelled

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

create table if not exists change_request_comments (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references change_requests(id) on delete cascade,
  author_id     text not null,
  is_superadmin boolean not null default false,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists change_request_comments_request_idx on change_request_comments (request_id, created_at);

create table if not exists change_request_attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references change_requests(id) on delete cascade,
  filename     text not null,
  content_type text not null,
  size_bytes   integer not null,
  storage_path text not null,   -- path within the 'request-attachments' Storage bucket
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists change_request_attachments_request_idx on change_request_attachments (request_id, created_at);

alter table change_request_events      enable row level security;
alter table change_request_comments    enable row level security;
alter table change_request_attachments enable row level security;

-- Private bucket — the API is the only thing that touches it, always via
-- short-lived signed URLs it mints itself (service-role key bypasses RLS,
-- same convention as every other table in this schema).
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

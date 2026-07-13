-- Additive migration for the existing DB — Phase 4 slice 4 (change requests +
-- notifications). Safe to run: only adds what's missing, never drops or
-- rewrites existing data. Paste into the Supabase SQL editor.

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

-- One row per client. Per-event toggles for which channels fire on which
-- events — jsonb rather than columns since the event set will keep growing
-- (report.ready lands in slice 6, more events after).
create table if not exists notification_settings (
  client_id         uuid primary key references clients(id) on delete cascade,
  email_enabled     boolean not null default false,
  email_to          text,
  slack_enabled     boolean not null default false,
  slack_webhook_url text,
  events            jsonb not null default '{}',
  updated_at        timestamptz not null default now()
);

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

alter table change_requests      enable row level security;
alter table notification_settings enable row level security;
alter table notification_log     enable row level security;

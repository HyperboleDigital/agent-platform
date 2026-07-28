-- Additive — "Local Presence" (Offer Sheet A, Tier 2): the citation/NAP
-- tracker and the Google Business Profile activity log. Both are deliberately
-- MANUAL for now: the Google Business Profile API needs a Google-approved
-- access request, and citation building is relationship/submission work an
-- agency does by hand anyway. These tables are what the client sees proving
-- the work happened, and are the exact shape a later API integration would
-- populate automatically instead of by hand. Safe to run.

-- One row per directory listing we're tracking for a client (Yelp, BBB, Angi,
-- chamber of commerce, …). `status` is maintained by hand; NAP fields record
-- what that directory actually shows, so the dashboard can diff them against
-- the client's canonical NAP (clients.portal_config.nap*) and flag drift.
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
alter table citations enable row level security;

-- One row per Google Business Profile action taken for a client. This is what
-- backs the sheet's "weekly posts, category and service optimization, photo
-- management, Q&A seeding" promise — the client sees a dated log proving the
-- cadence, rather than taking it on faith.
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
alter table gbp_activity enable row level security;

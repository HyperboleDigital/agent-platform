-- Additive — cold-outreach prospecting engine (v1: discovery + drafts).
-- An admin/superadmin tool to FIND local businesses that fit our services,
-- draft a personalized outreach email for each, and hand the operator a list
-- they send themselves from their own inbox. The platform NEVER sends email
-- here — there is no send path, no scheduler, nothing automatic (so the email
-- guardrails aren't in play). Discovery comes from the Google Places API
-- (already wired, PLACES_API_KEY); drafts from the LLM `complete()` helper.
-- Safe to run.

-- One row per prospect. `place_id` is the Places dedup key so the same business
-- found across repeated searches collapses to one row. `email` is nullable and
-- manual — Places never returns owner emails. A null `website` marks a prime
-- "we'll build you one" target. Drafts are stored (regenerable) so the CSV
-- export the operator works from carries them.
create table if not exists prospects (
  id            uuid primary key default gen_random_uuid(),
  place_id      text unique,
  name          text not null,
  category      text,          -- vertical searched (e.g. "med spa")
  area          text,          -- area searched (e.g. "Tampa, FL")
  phone         text,
  email         text,          -- nullable, manual
  website       text,          -- nullable; absent = prime target
  maps_url      text,
  rating        numeric,
  review_count  integer,
  -- new|saved|drafted|sent|replied|won|lost|do_not_contact
  -- `sent` is a manual mark by the operator (they sent from their own Gmail).
  status        text not null default 'new',
  draft_plain   text,          -- latest AI draft: plain personalized email
  draft_loom    text,          -- latest AI draft: Loom variant (with link slot)
  hook_source   text,          -- what personalization was based on (audit/homepage/no-website)
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists prospects_status_idx on prospects (status, created_at);
create index if not exists prospects_area_idx on prospects (area, category);
alter table prospects enable row level security;

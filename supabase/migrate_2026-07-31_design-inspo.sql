-- Prospecting v3: concepts become real HTML pages instead of generated images.
--
-- The image pipeline (gpt-image-1) could only ever produce a picture of a
-- fold — no below-fold sections, garbled nav text, and no way to place the
-- prospect's actual logo. Concepts are now full HTML documents written by a
-- vision model, steered by an operator-curated library of design references
-- rather than the model's own taste.
--
-- Additive and backwards-compatible: existing mockup rows keep format='image'
-- and keep rendering exactly as they were when their preview link was shared.

-- ── design_references ────────────────────────────────────────────────────────
-- The operator's inspo library — uploaded images (Figma comps, Dribbble shots,
-- screenshots of sites they like). This is the ONLY mechanism steering design
-- direction, so it is load-bearing: with an empty library, generation has
-- nothing to imitate.
--
-- `vertical` is a coarse tag (trades, medical, hospitality, ...). NULL means
-- "applies to any business" and acts as the fallback pool when a prospect's
-- vertical has no references of its own.
--
-- `notes` is fed to the model verbatim — "love the hero spacing", "too busy,
-- only take the colour palette" — so the operator can direct in their own
-- words rather than through a fixed schema.
create table if not exists design_references (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  vertical      text,
  notes         text,
  storage_path  text not null,                 -- design-inspo bucket
  content_type  text not null,
  size_bytes    integer,
  active        boolean not null default true, -- retire a reference without losing provenance
  created_at    timestamptz not null default now()
);
create index if not exists design_references_active_idx
  on design_references (active, vertical, created_at desc);

-- ── prospect_mockups: image → html ───────────────────────────────────────────
alter table prospect_mockups add column if not exists html text;
alter table prospect_mockups add column if not exists format text not null default 'image';
alter table prospect_mockups add column if not exists current_screenshot_path text;
alter table prospect_mockups add column if not exists reference_ids uuid[];

-- HTML mockups have no generated PNG, so the column that was mandatory for
-- image mockups can no longer be required.
alter table prospect_mockups alter column storage_path drop not null;

alter table prospect_mockups
  drop constraint if exists prospect_mockups_format_check;
alter table prospect_mockups
  add constraint prospect_mockups_format_check check (format in ('image', 'html'));

comment on column prospect_mockups.format is
  'image = legacy gpt-image-1 PNG in storage_path; html = generated page in html';
comment on column prospect_mockups.current_screenshot_path is
  'prospect-screenshots bucket: their existing site, for the before/after';
comment on column prospect_mockups.reference_ids is
  'design_references that steered this generation — provenance for "why did it look like that"';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Enabled with zero policies: the API uses the service-role key, which
-- bypasses RLS, so this is deny-all to anon/authenticated keys. Same
-- convention as every other table in schema.sql.
alter table design_references enable row level security;

-- ── Buckets ──────────────────────────────────────────────────────────────────
-- Private, like every other bucket here. Inspo images are operator-uploaded
-- and may be licensed work, so they must never be publicly addressable.
insert into storage.buckets (id, name, public)
values ('design-inspo', 'design-inspo', false)
on conflict (id) do nothing;

-- Screenshots of prospects' current sites, used for the before/after on the
-- preview page. Private for the same reason as prospect-mockups: a permanent
-- unrevokable *.supabase.co URL in a cold email reads as phishing.
insert into storage.buckets (id, name, public)
values ('prospect-screenshots', 'prospect-screenshots', false)
on conflict (id) do nothing;

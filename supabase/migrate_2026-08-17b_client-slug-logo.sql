-- Two independent additions to `clients`:
--
-- 1. `slug` — a clean, dashboard-only URL identifier (e.g. "spec-id"),
--    separate from Clerk's own auto-generated org slug (which is ugly —
--    "spec-id-1786210384551617496"). Editable by a superadmin from the
--    Config tab; auto-generated from `name` at creation and backfilled here
--    for existing rows. Used ONLY for building /clients/:slug URLs in the
--    dashboard — every internal API call still keys off the UUID `id`.
--
-- 2. `logo_path` / `logo_content_type` — an internal-dashboard-only org logo
--    (shown next to the client name in the app shell breadcrumb), stored in
--    a new private `org-logos` bucket and served via a signed URL through an
--    authenticated route. Deliberately separate from `widget_config.logoPath`,
--    which is the PUBLIC chat-widget logo served to anonymous website
--    visitors — different audience, different bucket, different route.
alter table clients add column if not exists slug text;
alter table clients add column if not exists logo_path text;
alter table clients add column if not exists logo_content_type text;

insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', false)
on conflict (id) do nothing;

-- Backfill: derive a slug from each existing client's name, de-duplicating
-- collisions by appending -2, -3, etc. in created_at order. One-time; new
-- clients get a slug assigned at creation time in application code.
with base as (
  select
    id,
    trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) as base_slug,
    row_number() over (
      partition by trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
      order by created_at
    ) as rn
  from clients
  where slug is null
)
update clients c
set slug = case when b.rn = 1 then b.base_slug else b.base_slug || '-' || b.rn end
from base b
where c.id = b.id;

create unique index if not exists clients_slug_idx on clients (slug);

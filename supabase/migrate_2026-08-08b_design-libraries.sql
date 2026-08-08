-- Design inspo libraries — replaces the free-text design_references.vertical
-- tag (which had to exact-match a prospect's raw Google Places category
-- string) with operator-named, operator-managed collections chosen explicitly
-- per prospect at generation time. Additive: existing `vertical` values are
-- migrated into libraries of the same name, and the old column is left in
-- place (deprecated, unused) rather than dropped. Safe to re-run.

create table if not exists design_libraries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);
-- Case-insensitive uniqueness so "Roofing" and "roofing" can't both exist —
-- the conflict target below relies on this exact index.
create unique index if not exists design_libraries_name_lower_idx on design_libraries (lower(name));

alter table design_references add column if not exists library_id uuid references design_libraries(id) on delete set null;
create index if not exists design_references_library_idx on design_references (library_id, active);

-- One row per distinct (case-insensitive) prior vertical value, so a batch
-- tagged "Trades" and another tagged "trades" collapse into one library
-- rather than two.
insert into design_libraries (name)
select distinct on (lower(trim(vertical))) trim(vertical)
from design_references
where vertical is not null and trim(vertical) <> ''
order by lower(trim(vertical)), trim(vertical)
on conflict ((lower(name))) do nothing;

update design_references dr
set library_id = dl.id
from design_libraries dl
where dr.vertical is not null
  and trim(dr.vertical) <> ''
  and lower(trim(dr.vertical)) = lower(dl.name)
  and dr.library_id is null;

-- Superseded by library_id (see above) — kept rather than dropped, since this
-- repo's migrations are additive-only. No code reads or writes it anymore.
comment on column design_references.vertical is
  'Deprecated — superseded by library_id (migrate_2026-08-08b_design-libraries.sql). No longer read or written.';

-- Which library (if any) was chosen for a given generation — provenance,
-- same purpose as the existing reference_ids column.
alter table prospect_mockups add column if not exists library_id uuid references design_libraries(id) on delete set null;

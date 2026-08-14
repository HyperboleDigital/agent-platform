-- Additive — prospect groups: an editable label that organizes the saved
-- prospects list into collapsible sections ("Roofers", "Med Spas") instead of
-- one flat list of every business ever saved. Export is scoped by it too.
--
-- Deliberately a separate column rather than reusing `category`: category is
-- the raw Places search term ("roofer") and stays a factual record of HOW the
-- business was found, while group_name is the operator's own organizing label
-- and must survive being renamed or reassigned without rewriting search
-- history. Backfilled from category so existing rows land in sensible groups
-- on day one. Safe to run.
alter table prospects add column if not exists group_name text;

-- Existing rows: seed the group from the search category. Title-cased here
-- only as a starting label — the operator renames from the dashboard.
update prospects
   set group_name = initcap(category)
 where group_name is null
   and category is not null
   and category <> '';

-- Anything with no category at all (shouldn't exist, but don't strand rows in
-- an invisible group) gets an explicit bucket.
update prospects set group_name = 'Ungrouped' where group_name is null;

-- Grouped listing reads by group then recency; status stays in the key because
-- the saved list is commonly filtered to one status at a time.
create index if not exists prospects_group_idx
  on prospects (group_name, status, created_at desc);

-- Additive migration — lets clients mark a lead as followed up (or back to
-- new) without deleting it. Deleting a lead outright is a superadmin-only
-- action (no UI control for clients yet, by design). Safe to run.

alter table leads add column if not exists status text not null default 'new';
-- status values: 'new' | 'followed_up'

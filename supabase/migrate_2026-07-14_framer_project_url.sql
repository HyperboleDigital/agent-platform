-- Additive migration for the existing DB — small follow-up to
-- migrate_2026-07-13_content.sql: framer_connections needs the Framer
-- project URL (framer-api's connect() takes a project URL, not just an
-- API key + collection ID). Safe to run: only adds what's missing.
-- Paste into the Supabase SQL editor.

alter table framer_connections add column if not exists project_url text not null default '';
alter table framer_connections alter column project_url drop default;

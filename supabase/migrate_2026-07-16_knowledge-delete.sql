-- Additive migration — lets the dashboard delete (or replace) a whole
-- uploaded document instead of only ever appending. Safe to run.
--
-- knowledge_base stores one row PER CHUNK (chunkText splits ingested content),
-- so a single upload can already span several rows sharing the same title —
-- document_id groups those chunks so "delete this document" and "list
-- documents" both operate on the whole upload, not one chunk at a time.
-- file_id links chunks back to the knowledge_files row holding the original
-- bytes (null for pasted-text documents, which have no original file).
-- description is a user-editable note shown in the dashboard table, set at
-- upload/paste time or edited later — independent of the extracted content.
--
-- IMPORTANT: document_id is added WITHOUT "not null default gen_random_uuid()"
-- in one shot on purpose. That form forces Postgres to rewrite the entire
-- table immediately (a volatile default can't use the fast-default
-- optimization), and rewriting means rebuilding every existing index too —
-- including the ivfflat vector index on `embedding`, which needs far more
-- maintenance_work_mem than Supabase's default (32MB) allows. Adding the
-- column bare, backfilling with a plain UPDATE, then adding the constraint
-- after avoids the rewrite entirely — each step here is cheap.
--
-- The index over document_id is intentionally a separate file too — see
-- migrate_2026-07-16b_knowledge-delete-index.sql (optional, performance-only).

alter table knowledge_base add column if not exists document_id uuid;
alter table knowledge_base add column if not exists file_id uuid references knowledge_files(id) on delete set null;
alter table knowledge_base add column if not exists description text;

-- Backfill: give every existing row (pre-dating this column) its own
-- document_id so old single-chunk docs still behave correctly. Multi-chunk
-- docs ingested before this migration will show as separate documents in the
-- list — acceptable, since there's no reliable way to regroup them after the
-- fact; re-upload if you want a pre-existing multi-chunk doc to delete/replace
-- as one unit.
update knowledge_base set document_id = gen_random_uuid() where document_id is null;

alter table knowledge_base alter column document_id set not null;
alter table knowledge_base alter column document_id set default gen_random_uuid();

-- Optional performance index — run this by itself (separately from
-- migrate_2026-07-16_knowledge-delete.sql) so a memory error here can't
-- roll back that migration's column adds too.
--
-- Without this index, listing/deleting a document still works correctly —
-- Postgres just falls back to using the existing client_id index and
-- filtering document_id in-memory, which is fine at this table's size.
-- Safe to skip entirely if it keeps failing on memory.

begin;
set local maintenance_work_mem = '128MB';
create index if not exists knowledge_base_document_idx on knowledge_base (document_id);
commit;

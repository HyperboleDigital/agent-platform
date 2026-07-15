-- Additive migration — stores the original bytes of uploaded knowledge-base
-- files (previously only extracted text was kept), so the dashboard can show
-- a Google-Drive-style preview. Safe to run: only adds what's missing.

create table if not exists knowledge_files (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  filename     text not null,
  content_type text not null,
  size_bytes   integer not null,
  storage_path text not null,   -- path within the 'knowledge-files' Storage bucket
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists knowledge_files_client_idx on knowledge_files (client_id, created_at desc);

alter table knowledge_files enable row level security;

insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;

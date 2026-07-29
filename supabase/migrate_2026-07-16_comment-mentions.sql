-- Additive — @mention support on change-request comments. mentions is an array
-- of Clerk user IDs explicitly selected via the compose UI's picker (not parsed
-- from free text), so notifying the right person is reliable. Safe to run.

alter table change_request_comments add column if not exists mentions text[] not null default '{}';

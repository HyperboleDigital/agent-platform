-- A genuine platform-level Gmail sender — not borrowed from any client. All
-- platform-sent email (Clerk-relayed system emails, reports, change-request
-- notifications) previously piggybacked on a real client's own Gmail
-- connection via PLATFORM_SENDER_CLIENT_ID (see migrate_2026-08-08b's
-- predecessor commit and TODO.md) — fragile, since disconnecting or deleting
-- that client silently broke platform email too. This table gives the
-- platform its own connection, connected by a superadmin from Overview, fully
-- independent of the clients table. Safe to re-run.

-- Singleton: `id boolean primary key default true check (id)` allows exactly
-- one row ever — a second insert violates the primary key, which is the
-- point (there is only ever one platform sender).
create table if not exists platform_gmail_token (
  id            boolean primary key default true check (id),
  email         text not null,
  refresh_token text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

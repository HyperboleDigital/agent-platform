-- Additive migration for the existing DB — Phase 4 slice 1 (service entitlements).
-- Safe to run: only adds what's missing, never drops or rewrites existing data.
-- Paste into the Supabase SQL editor.

-- Mirror of ALL line items on a client's Stripe subscription (base plan +
-- add-on services). subscriptions.stripe_price_id keeps meaning "the base
-- plan item"; this table is what add-on entitlements resolve from.
create table if not exists subscription_items (
  id                              uuid primary key default gen_random_uuid(),
  client_id                       uuid not null references clients(id) on delete cascade,
  stripe_subscription_item_id     text not null unique,
  stripe_price_id                 text not null,
  quantity                        int not null default 1,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create index if not exists subscription_items_client_idx on subscription_items (client_id);

-- Superadmin-granted service access without a Stripe purchase (comps).
-- Soft-revoked via revoked_at so grants keep an audit trail.
create table if not exists service_grants (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  service_key text not null,
  source      text not null default 'comp',
  granted_by  text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (client_id, service_key)
);
create index if not exists service_grants_client_idx on service_grants (client_id);

alter table subscription_items enable row level security;
alter table service_grants     enable row level security;

-- Per-client custom line items (2026-08-18): a client's billing is now a tier
-- TEMPLATE plus an arbitrary set of custom line items — add, remove, re-price,
-- or comp anything for a specific deal. These are a billing/presentation
-- concern ONLY: a line item never grants access to a feature (that stays the
-- comp path in service_grants — see lib/line-items.ts). Safe to run.

create table if not exists client_line_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  label text not null,
  description text,
  amount_cents integer not null,
  cadence text not null check (cadence in ('monthly', 'one_time')),
  -- 'included' = shown on the info sheet at $0 as a deal sweetener.
  -- Keep amount_cents at its real value and let this flag zero it at billing
  -- time, so we can always see what we gave away.
  included boolean not null default false,
  stripe_price_id text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists client_line_items_client_idx on client_line_items(client_id, sort_order);

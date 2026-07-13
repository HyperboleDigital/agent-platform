-- Additive migration for the existing DB — Phase 2 (Stripe billing).
-- Safe to run: only adds what's missing, never drops or rewrites existing data.
-- Paste into the Supabase SQL editor.

create table if not exists subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null unique references clients(id) on delete cascade,
  stripe_customer_id    text not null,
  stripe_subscription_id text unique,
  stripe_price_id       text,
  status                text not null default 'incomplete',
  current_period_end    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on subscriptions (stripe_customer_id);
create index if not exists subscriptions_stripe_sub_idx on subscriptions (stripe_subscription_id);

alter table subscriptions enable row level security;

-- Manual tier mapping for legacy subscriptions (2026-09-04).
--
-- A subscription whose Stripe price predates the consolidated tier catalog
-- (retired Starter/Pro plans, ad-hoc deals) can't be resolved by lib/tiers.ts
-- tierForPriceId, so the dashboard showed "Unknown plan", the client's
-- tier_key never synced, and the client couldn't change their plan.
--
-- subscriptions.tier_key mirrors the resolved tier for the base item — from
-- the price when the catalog recognizes it, else from the subscription's
-- tier_key Stripe metadata, which a superadmin can now stamp via
-- POST /billing/:id/subscriptions/:subId/map-tier ("Map to tier" on the
-- billing tab). Stripe metadata stays the source of truth; this column just
-- lets planForSubscription resolve without a Stripe round-trip.
--
-- lib/billing.ts degrades gracefully pre-migration (retries the legacy row
-- shape on upsert), so deploy order doesn't matter — but legacy plans stay
-- unresolved until this runs.

alter table subscriptions add column if not exists tier_key text;

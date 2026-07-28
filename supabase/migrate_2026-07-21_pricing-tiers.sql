-- Additive — the finalized Hyperbole Digital pricing sheet (Local Services vs
-- B2B, three tiers each) as two plain columns on `clients`. Deliberately NOT a
-- new table or a Stripe product yet — Owen is still iterating on the pricing
-- sheet, so the tier catalog lives hardcoded in lib/tiers.ts (same pattern as
-- lib/billing.ts's PLANS / lib/services.ts's CATALOG) and just needs somewhere
-- on the client row to record which tier they're on. No FK: the catalog is
-- code-defined, not DB-defined, exactly like the existing PLANS/CATALOG
-- pattern. Safe to run.

alter table clients add column if not exists vertical text check (vertical in ('local', 'b2b'));
alter table clients add column if not exists tier_key text;

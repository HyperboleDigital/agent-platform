-- Pricing restructure (2026-08-18): the six Local/B2B tiers collapse into one
-- three-tier ladder (care / seo / growth). Remap every client's tier_key to the
-- consolidated catalog in lib/tiers.ts. `clients.vertical` stays as a column
-- (harmless, maybe useful for segmentation) but is NO LONGER a pricing
-- dimension — nothing filters tier options by it anymore.
--
-- Also adds `clients.hosting`: who owns the platform the client's site runs
-- on. 'us' (default) = we host → Care is the default retainer and the
-- hosting/uptime bullet + Site Health card apply. 'client' = they own the
-- platform (e.g. a Squarespace build) → the default retainer is the chatbot,
-- and hosting promises/Site Health are suppressed (we can't act on uptime for
-- a site we don't host).
--
-- Safe to run; idempotent.

update clients set tier_key = 'care'   where tier_key in ('local-care', 'b2b-care');
update clients set tier_key = 'seo'    where tier_key = 'local-seo';
update clients set tier_key = 'growth' where tier_key in ('local-growth', 'b2b-momentum', 'b2b-growth');

alter table clients add column if not exists hosting text
  check (hosting in ('us', 'client')) default 'us';

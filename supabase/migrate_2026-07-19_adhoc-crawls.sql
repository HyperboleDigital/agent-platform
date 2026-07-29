-- Additive — allow ad-hoc (client-less) crawl audits so a superadmin can audit
-- ANY url (e.g. a sales prospect's site) on demand, not just an existing
-- client's domain. Part of the SEO-automation plan. Safe to run.

alter table seo_crawls alter column client_id drop not null;

-- SEO-fix tracking on change requests (handoff #3 §3 + §5).
--
-- source: distinguishes client-filed requests from platform-generated SEO
-- fixes ('seo_fix' — set by createMetaFixRequest / createSchemaFixRequest /
-- createLlmsTxtRequest). The month summary counts fixes without mistaking
-- them for client asks.
--
-- fix_meta: what the fix targeted, so the monthly fix_verify job can check
-- the latest crawl for it: { "checkKeys": string[], "urls": string[] }.
-- checkKeys empty = not crawl-verifiable (schema / llms.txt fixes are
-- verified by their own presence checks, or stay manual).
--
-- verified_at / regressed_at: set by the fix_verify job on a request whose
-- status is 'done' — verified when the latest finished crawl no longer flags
-- its URLs for its checks, regressed when it still does. The job clears the
-- opposite column each pass so the pair always reflects the LATEST crawl.
-- "issuesFixed" in the month summary counts verified_at, never bare 'done'.
--
-- Safe to run; idempotent; additive only.

alter table change_requests add column if not exists source text not null default 'client';
alter table change_requests add column if not exists fix_meta jsonb;
alter table change_requests add column if not exists verified_at timestamptz;
alter table change_requests add column if not exists regressed_at timestamptz;

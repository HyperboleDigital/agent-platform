-- Additive — store an "AI Search Health" (GEO) result on each crawl: whether the
-- site blocks AI crawlers (robots.txt) and whether it has an llms.txt, plus a
-- score. Cheap to compute (a couple of HTTP fetches), directly on our GEO
-- thesis. Part of the SEO-automation plan. Safe to run.

alter table seo_crawls add column if not exists ai_search jsonb;

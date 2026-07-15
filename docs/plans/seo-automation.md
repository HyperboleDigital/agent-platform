# Plan: Automated SEO / GEO Pipeline

**Status:** approved, not started. Next action = Phase 0.
**Owner:** Owen. **Started:** 2026-07-15.
**Sibling plan:** [website-rebuild.md](./website-rebuild.md) (built second, shares the crawler).

> This is a living document. Append to the **Checkpoint log** at the bottom
> whenever progress is made or a decision changes, so a fresh chat can resume
> without losing context. Treat the top sections as the agreed design and the
> log as the running state.

## Goal

Input a URL → a full SEO/GEO audit runs automatically → fixes are generated →
results are tracked → a branded report is produced. Frictionless and low-cost
(pennies of crawl + a few dollars of tokens per client/month).

## Strategic thesis

The market has shifted from "can you rank?" (SEO) to "are you the cited answer?"
(AEO/GEO). We are unusually well positioned because we already own two of the
inputs that actually win GEO and that generic rank-trackers don't have:

1. **The chatbot captures real customer questions** — the exact "mine real
   questions, not modeled prompt volume" input the market says to build content
   around.
2. **AI-visibility runs already track citations** across ChatGPT/Claude.

So GEO is largely *surfacing data we already collect*, not net-new infra. Treat
it as Phase 4, layered on the SEO pipeline — not a separate product.

## Product shape: two tiers of audit

- **Tier 0 — Free instant audit (lead magnet).** Any URL, no login. Technical
  crawl + PageSpeed + AI-visibility snapshot. Costs ~$1. This is the growth
  engine: "input any URL" becomes client *acquisition*, working on prospects'
  sites. Fixes + the GSC layer are gated behind signup.
- **Deep audit (paid / retainer).** Adds GSC data (cannibalization, real
  rankings) once the client grants property access. This is the two-tier split
  that turns the setup friction into a feature: Tier 0 sells, deep audit
  delivers.

## Pricing

Price on outcome, never on our cost (COGS is pennies). Value-based.

- **Free instant audit** — lead magnet, no commitment.
- **One-time deep audit + roadmap (~$750)** — no-commitment on-ramp; this is
  literally the deliverable the studied agency sells. Credit it toward month 1
  if they sign a retainer.
- **Starter (~$500–750/mo)** — one site, monitoring, monthly re-audit + report,
  ~10 implemented fixes/mo.
- **Growth (~$1,500/mo)** — one site, higher fix volume, content consolidation,
  GEO/AI-visibility tracking, biweekly reporting.
- **Scale ($3k+/mo)** — for multi-site / multi-location clients: Growth across
  all their properties, higher volume, + a monthly strategy call. *May launch
  with Starter + Growth only and add Scale when a multi-location client appears.*

**Contract terms (load-bearing — SEO lags, so this protects retention):**
- **6-month minimum on all retainers.** Tied deliberately to the results ladder:
  it's how long the lagging metrics (traffic/leads) take to move. Shorter =
  guaranteed disappointed client.
- **Prepay 6 months → 1 month free (or ~10–15% off).** The one we want — funds
  the work, fixes cash flow, feels like the client's win.
- After the initial term → month-to-month (they stay because it works).
- **Tie tier caps to fix-generation volume** — that's the only expensive part
  and the natural upgrade lever. Monitoring/audits can be ~unlimited.

## Dashboard: two different views

- **Client view = confidence-and-results.** Everything answers "is my money
  working?": SEO health score trending up (hero number), wins shipped this month
  ("12 images optimized, 8 posts consolidated"), impressions/rankings/citation
  trends, the monthly report, open requests. Plain language everywhere — this is
  also the fix for the earlier "what is average position?" complaint.
- **Admin (Owen) view = business-ops cockpit.** Answers "is this account healthy
  for me?": **margin per client** (revenue vs actual token+crawl spend), audit/fix
  queue across the fleet, **churn-risk flags** (score flat 60d, no results
  landing, fixes piling up unapproved), cost controls/throttles, raw data.

## Expectations: the results ladder

SEO results lag 3–6 months; clients churn in month 2 if only promised traffic.
Show a ladder where early rungs light up in *weeks*:

> Fixes shipped → Technical health ↑ → Impressions ↑ → Rankings/citations ↑ →
> Traffic ↑ → Leads/revenue ↑

Month one shows real, visible progress ("23 fixes shipped, health 61→78,
impressions ticking up") that buys runway for traffic to arrive.

## Grounded projections (not fabricated numbers)

Clients need a *number* to grasp upside. Don't invent one — derive a defensible
one from the audit's own data, and always label it "projected potential" with a
range:

> "These terms get 8,000 impressions/mo at avg position 8 (~1.5% CTR ≈ 120
> clicks). Page-one positions (~10% CTR) would capture ~600–900 visits/mo — a
> 5–7x increase on this cluster."

Impressions are real (GSC), CTR-by-position curves are public, the range and
"projected" label protect us. **Rule:** projections live in the roadmap; the
monthly report shows only *measured* results. Keep the two visually separate —
never present a projection as measured or guaranteed. Claude can generate these
automatically from GSC data.

## Phases (each proven cheap on ONE client before going fleet-wide)

### Phase 0 — Cost-safe test harness *(START HERE)*
- Wire **DataForSEO On-Page API** against **one site**, capped at ~25 pages.
- Audit synthesis with **Haiku** (mechanical classification — cheap), not Opus.
  Reserve Opus for the client-facing narrative later.
- **Also build the background-job + status infra here** (even one audit is a
  multi-minute job; the current synchronous API pattern will time out). This is
  the same machinery the scheduler needs later — build once. ("audit running…
  40%").
- **Deliverable: a real cost-per-audit number in front of Owen before anything
  is wired to run automatically.**

### Phase 1 — Audit engine
- Raw crawl → the two agency artifacts: severity→issue→pages→description tracker,
  and the prioritized roadmap (Quick Wins → Structural → Consolidation →
  Optimization).
- Fold in existing signals: PageSpeed (CWV), GSC (cannibalization), visibility
  runs (citations).
- Rebuild the confusing Rankings section around this with plain-language
  explanations baked in.

### Phase 2 — Fix generation → change requests
- Claude generates fix *assets*: alt text (vision), JSON-LD schema, WebP
  compression, meta descriptions, consolidation drafts, redirect maps.
- Each lands as a one-click **change request** (reuses existing Requests system).
  CMS-agnostic, low-risk. Direct Framer/Webflow write-back is a later add-on
  (and becomes trivial for clients whose site we rebuilt — see sibling plan).
- **Token discipline:** generate on-demand per approved issue, in batches — never
  "regenerate everything on every audit." Prove cheap first.

### Phase 3 — Automated reporting
- Auto-generate the branded monthly report (Artifact/PDF) with before/after
  metrics from GSC + PageSpeed + visibility runs.

### Phase 4 — GEO layer
- Surface the chatbot's captured customer questions + citation tracking as the
  GEO product. Mostly presentation of data already collected.

### Cross-cutting: Scheduler
- Everything periodic (recurring crawls, GSC snapshots, monthly reports) needs
  the scheduler (see TODO.md — doesn't exist yet). The job infra from Phase 0 is
  its foundation. **Guardrail: nothing scheduler-reachable may import the email
  path** (582-email incident — see HANDOFF.md).

## What's needed from Owen before Phase 0 can run
- A **DataForSEO** account (pay-as-you-go). Drop the credential into
  `apps/api/.env` yourself (same pattern as GSC) — don't paste it in chat.
  (Exact env var name + signup steps: TBD in first Phase 0 message.)

## Product surface: client view + free-audit lead magnet (design)

Turns the superadmin-beta engine into the actual two-tier product. Two parts:

### Part A — Client-facing audit view (safe; build first)
- Entitled `seo` clients see their **latest crawl**, read-only: the /100 health
  score as the hero metric, the severity-ranked issues with affected pages, all
  in plain language (results-ladder framing — lead with score + wins so progress
  is felt early).
- **Running crawls and generating fixes stay superadmin-only** — they spend
  money/tokens, and fix volume is the paid lever (see Pricing). Clients view the
  results their account manager produces; they don't burn our balance by clicking.
- Route change: `GET /:id/seo/crawl` (latest, pure read) allowed for entitled
  clients; `POST /crawl`, the poll/finalize `GET /crawl/:crawlId`, and all fix
  routes stay superadmin-only.

> **Update 2026-07-15:** Owen chose to start with an **admin-only Audit Tool**
> instead of the public lead magnet — a superadmin runs audits on any URL on
> demand (no public endpoint, no automation), which drops all the abuse/spend/
> flag complexity below. Built (see checkpoint). The public version (Part B) is
> still a valid future option but is deferred.

### Part B — Free-audit lead magnet (design; deferred in favor of admin tool)
Public "audit any URL" page: prospect enters **URL + email** → sees their score +
top 3 issues → CTA to sign up / book a call. The email is the lead capture (the
whole point) and doubles as a throttle. It works on *prospects'* sites, so
"input any URL" becomes an acquisition channel.

**Mandatory guardrails before it can go live (each spends ~$0.02+ per hit):**
- Feature flag `ENABLE_PUBLIC_AUDIT` (default OFF) — dormant until deliberately enabled.
- **Global daily cap** on public audits (protects the DataForSEO balance, e.g.
  20/day ≈ ≤ $0.40/day worst case), persisted (survives restarts).
- Per-IP + per-email rate limit (reuse `lib/rate-limit.ts`).
- Store captured leads (email + url + score + timestamp) in a `public_audit_leads`
  table for follow-up.
- Show only a **teaser** (score + top 3 issues); the full report requires signup —
  keeps the free audit a conversion tool, not a giveaway.
- Never scheduled; always a live user action. Never touches the email path.
- Prereq: DataForSEO balance top-up before enabling.

## Open questions / deferred
- Direct CMS write-back (Framer/Webflow) for fixes — deferred to post-Phase-2.
- Blog content engine as a client service — content-generation already exists
  (`lib/content.ts`); productizing "blog + participate in existing communities"
  (Reddit/Quora) is a service-play, not a build. No own-forum (cold-start trap).

## Checkpoint log
- **2026-07-15 (Audit Tool UI — SEMrush-style redesign, draft)** — New
  `components/audit-report.tsx` used by the Audit Tool: score gauges (Site Health
  + AI Search Health, color-coded), a category-breakdown chip row (Titles & meta,
  Content, Images, Security, Links, Performance, Structure, AI Search/GEO), and
  issues grouped by category with expandable rows (click → explanation + affected
  URLs). Also added a "you can leave this page" note + live page count to the
  running state. Frontend-only, typechecks. Client-facing `CrawlResults` left
  simple. Rough draft per Owen's request — iterate after he tests. Still TODO:
  resume polling on reload (currently the run() loop drives polling, so leaving
  mid-crawl stops the frontend updates though the crawl finishes server-side).
- **2026-07-15 (Fix type 3 — llms.txt generator, VERIFIED)** — Closes the GEO
  loop: the AI Search check detects a missing llms.txt, this generates one.
  `draftLlmsTxt`/`createLlmsTxtRequest` in `seo-fixes.ts` build a spec-compliant
  llmstxt.org file (H1 name, blockquote summary, `## Key pages` bullets) grounded
  in the client's real pages; delivered as a change request. Route
  `POST /:id/seo/fix/llms` (superadmin); dashboard "llms.txt" fix button shown
  only when the crawl detected it's missing (`aiSearch.hasLlmsTxt === false`).
  Verified free on hyperbole's pages — clean, usable output. Trio of GEO-flavored
  fixes now: titles/meta, schema, llms.txt.
- **2026-07-15 (AI Search Health — LIVE-VERIFIED end-to-end)** — Migration
  applied. Full ad-hoc crawl of hyperboledigital.com returned site health 92.72
  AND ai_search {score 90, blockedBots [], hasLlmsTxt false} in the finalized
  row. GEO check is DONE. Natural follow-on: an llms.txt generator fix type
  (we now detect it's missing).
- **2026-07-15 (AI Search Health / GEO check — BUILT, verified standalone)** —
  Compared our audit to a real SEMrush Site Audit of hyperboledigital.com: health
  89% (SEMrush) vs 92.7 (ours) = validated. SEMrush's paid "AI Search Health"
  revealed the GEO recipe, which we built ourselves for free: `lib/ai-search.ts`
  `checkAiSearch()` fetches robots.txt (detects blocking of 15 AI crawlers —
  GPTBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended, etc.) + checks
  for llms.txt, producing a 0-100 AI-search score + issues. Wired into the crawl
  finalize (`ai_search` jsonb column, `migrate_2026-07-20_ai-search.sql`) and
  shown in `CrawlResults` as a second score + a GEO issues block. Verified
  standalone: hyperbole 90/100 (0 blocked, no llms.txt — matches SEMrush's
  finding), nytimes.com 6/100 (correctly caught its 14 blocked AI bots). **Full
  crawl integration needs `migrate_2026-07-20_ai-search.sql` applied.** This is
  the GEO differentiator — SEMrush charges for it; we do it for pennies.
- **2026-07-15 (Reports integration — VERIFIED)** — Client monthly Reports now
  include a **Site Health** section (crawl `onpage_score` + top 3 issues by
  severity), sourced from the client's latest finished crawl via `getLatestCrawl`
  in `buildReport`. Added to `ReportData`, the report email body, and the Reports
  page UI. Verified cost-free by injecting a fake finished crawl → the section
  populated in both the data and rendered email, then cleaned up. Manual
  (superadmin builds/sends reports) — no automation. Note: report now shows both
  a PageSpeed "SEO score" and the crawl "Site Health score" — different metrics,
  minor future cleanup candidate.
- **2026-07-15 (Admin Audit Tool — LIVE-VERIFIED)** — Migration applied.
  Verified the client-less path end-to-end on example.com (score 95.24, issues
  synthesized w/ severity + affected URL, listAdhocCrawls returned it, test row
  cleaned up). Admin Audit Tool is DONE — superadmin can audit any URL on demand.
- **2026-07-15 (Admin Audit Tool — BUILT, needs migration to verify)** — Owen's
  chosen direction: superadmin runs audits on ANY url on demand (prospects etc.),
  no public flow, no automation. `seo_crawls.client_id` made nullable
  (`migrate_2026-07-19_adhoc-crawls.sql`) so a crawl need not belong to a client.
  `dataforseo.ts` refactored: shared `finalizeIfNeeded`; new `startAdhocCrawl`
  / `refreshAdhocCrawl` / `listAdhocCrawls`. Superadmin routes on overviewRouter
  (`GET/POST /overview/audits`, `GET /overview/audits/:id`). New `/audit-tool`
  page + superadmin nav item (Search icon); extracted a shared `CrawlResults`
  component reused by both the client Site Health card and the tool. Typechecks
  clean. **Not yet live-verified — run `migrate_2026-07-19_adhoc-crawls.sql`
  first** (startAdhocCrawl posts the paid task before insert, so don't run it
  pre-migration).
- **2026-07-15 (Part A — client-facing audit view, BUILT)** — Crawl audit now
  visible read-only to entitled seo clients (was superadmin-only). `GET
  /:id/seo/crawl` (latest, pure read) opened to entitled clients; `POST /crawl`,
  poll/finalize `GET /crawl/:crawlId`, and all fix routes stay superadmin-only
  (they spend money/tokens). `CrawlCard` renders the /100 score + issues for
  everyone, gates the Run + Generate-fixes buttons behind `me.isSuperadmin`, and
  shows a client-friendly empty state; title is now "Site Health Audit" (beta
  badge admin-only). Typechecks clean; gating reviewed (not browser-verified —
  pure auth/render change). **Part B (public free-audit lead magnet) is designed
  above, not built — needs the guardrails + a DataForSEO balance top-up.**
- **2026-07-15 (decision: defer alt-text fix)** — Do NOT build a custom
  vision-based alt-text pipeline. Solve it via the platform instead: Framer has
  native/AI alt-text (so rebuilt-on-Framer clients get it free — reinforces the
  ownership thesis, see [website-rebuild.md]), and cheap third-party plugins/tools
  cover non-Framer clients. Revisit when relevant; not a build item for now.
- **2026-07-15 (Phase 2 — schema fix type, LIVE-VERIFIED)** — Second fix type:
  schema.org JSON-LD (`draftSchemaFixes`/`createSchemaFixRequest`), operates on
  the client's key pages (no paid crawl needed → free to verify), directly serves
  GEO/AEO. Route `POST /:id/seo/fix/schema` (superadmin) + a "Schema markup"
  button alongside the meta-fix one. Verifying caught two real bugs (guessed logo
  URL; invalid `@type: "Project"`) → tightened the prompt to require valid
  schema.org types and forbid invented URLs/asset paths; re-verified clean
  (LocalBusiness + CreativeWork, grounded, no fake URLs). Known minor rough edge:
  can still over-reach on a `founder`/entity name — acceptable because every fix
  is a human-reviewed change request, not auto-applied. Next candidate fix type:
  alt text (vision). GEO is the term to market under (see plan discussion).
- **2026-07-15 (Phase 2 — fix generation, first type LIVE-VERIFIED)** — Turn
  crawl issues into Claude-generated fixes delivered as one-click change requests.
  First fix type = **titles + meta descriptions** (`lib/seo-fixes.ts`): finds the
  title/desc-flagged URLs from the crawl, fetches each page's real content (free),
  one cheap Haiku call rewrites all pages' title (≤60) + meta description (≤155)
  grounded in actual copy. Generation (`draftMetaFixes`) is side-effect-free;
  delivery (`createMetaFixRequest`) wraps it + `createRequest`. Route
  `POST /:id/seo/crawl/:crawlId/fix/meta` (superadmin); dashboard shows a
  "Generate fixes: Titles & meta descriptions" button when eligible. Verified
  live on hyperboledigital.com — produced strong, specific rewrites and correctly
  caught duplicate titles across /projects and /contact. Cleaned up. Next fix
  types to add alongside: alt text (vision), JSON-LD schema. Then: client-facing
  view + free-audit lead magnet; scheduler for auto-runs.
- **2026-07-15 (Phase 1 — per-issue URL mapping, LIVE-VERIFIED)** — Each issue
  now lists the exact affected page URLs (the agency-spreadsheet "which pages"
  column). `fetchAffectedUrls` pulls `/on_page/pages` (free retrieval, no extra
  cost), maps each PROBLEM_CHECK → URLs; synthesis now echoes the check `key` so
  URLs attach 1:1 to each synthesized issue; dashboard `AffectedUrls` renders a
  truncated, expandable list of page paths per issue. Verified live against
  hyperboledigital.com (e.g. "Title tags too short → /projects/fyul, …"),
  cleaned up. Typechecks clean. Next: client-facing audit view + free-audit lead
  magnet; then fix generation (Phase 2).
- **2026-07-15 (Phase 0 LIVE-VERIFIED)** — Ran the full pipeline end-to-end
  against Spec-ID temporarily pointed at hyperboledigital.com (migration applied
  by Owen): DB write → DataForSEO crawl → problem curation → Haiku synthesis →
  finalize all worked. Haiku produced an excellent severity-ranked, plain-English
  tracker (missing H1 = high, HTTP link = high, low content = medium, missing alt
  = low) — Anthropic credits are working again. Test row deleted + Spec-ID
  restored afterward. **Phase 0 is DONE and proven.** Remaining before it's
  client-facing: per-issue→URL mapping (Phase 1), the free-audit lead-magnet
  surface, and scheduler/job infra for auto-runs.
- **2026-07-15 (Phase 0 built)** — Real in-app integration written + typechecks
  clean (API + dashboard). New: `supabase/migrate_2026-07-18_seo-crawls.sql`
  (`seo_crawls` table); `apps/api/src/lib/dataforseo.ts` (pull-based job:
  `startCrawl` posts the On-Page task, `refreshCrawl` polls + finalizes, curates
  DataForSEO's checks down to real *problems* only via `PROBLEM_CHECKS`, then
  Haiku-synthesizes a severity-ranked tracker — synthesis is non-fatal, falls
  back to raw problem counts if LLM credits are low); superadmin-only routes
  `POST/GET /:id/seo/crawl` + `GET /:id/seo/crawl/:crawlId`; dashboard
  `CrawlCard` (superadmin-gated) in `Seo.tsx` with score hero + issue list +
  crawl-cost display. **Not yet live-verified in-app** — needs the migration
  applied to Supabase, then a real run. onpage_score/checks field paths are
  probe-confirmed; `crawl_status.pages_crawled` path is a best-guess
  (non-critical). No auto/scheduled runs — manual superadmin button only.
- **2026-07-15 (Phase 0 probe)** — DataForSEO On-Page verified live against
  hyperboledigital.com via a throwaway probe script (`apps/api/.env` creds).
  **Measured cost: $0.018 for a ~10-page crawl (~$0.002/page)** — balance
  $1.00 → $0.982. Extrapolates to ~$0.05 for 25 pages, ~$0.20 for 100 pages, so
  even with Claude synthesis tokens an audit lands well under $1 → the
  free-instant-audit lead magnet is economically viable. Returned real
  agency-spreadsheet-style checks (onpage_score 92.72; no_h1_tag×2, no_image_alt×10,
  https_to_http_links×1, low_content_rate×10, etc.). Crawl is async (~50s for 10
  pages) → confirms Phase 0 needs the background-job infra, not a sync request.
  Real in-app integration (lib + route + Haiku synthesis + job infra) not yet
  built — this was cost validation only.
- **2026-07-15** — Plan approved by Owen. Decisions locked: DataForSEO On-Page
  crawler; auto-fix scope = generate + deliver as change requests (test cheap
  first); blog + community participation (no forum); Microsoft Clarity skipped
  (no marketing site in repo). Two-view dashboard, results ladder, grounded
  projections, tiered pricing w/ 6-month term all agreed. Not yet coded —
  awaiting DataForSEO account to begin Phase 0.

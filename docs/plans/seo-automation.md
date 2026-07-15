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

## Open questions / deferred
- Direct CMS write-back (Framer/Webflow) for fixes — deferred to post-Phase-2.
- Blog content engine as a client service — content-generation already exists
  (`lib/content.ts`); productizing "blog + participate in existing communities"
  (Reddit/Quora) is a service-play, not a build. No own-forum (cold-start trap).

## Checkpoint log
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

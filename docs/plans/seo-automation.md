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

> **SUPERSEDED 2026-07-21.** The ladder below was this plan's early proposal and
> is **no longer what we sell.** The finalized offer sheets (Local Services and
> B2B, three tiers each) are the source of truth, encoded in
> `apps/api/src/lib/tiers.ts`:
>
> | | Care | Mid | Top |
> |---|---|---|---|
> | **Local Services** | $495/mo | Local SEO $1,200/mo | Local SEO + Growth $2,400/mo |
> | **B2B** | $795/mo | Pipeline $2,500/mo | Growth Partner $4,500/mo |
>
> Builds: local $8,500 standalone / $4,500 with a 6-month retainer; B2B
> $12,000–18,000, not discounted. Retainers keep the 6-month minimum, then
> month-to-month. See `TODO.md` for which sheet promises are actually built.
>
> Kept below because the *reasoning* (price on outcome not COGS; tie caps to
> fix-generation volume, the only expensive part; 6-month minimum tied to how
> long lagging metrics take to move) still holds and shaped the final sheet.

Price on outcome, never on our cost (COGS is pennies). Value-based.

- **Free instant audit** — lead magnet, no commitment.
- ~~**One-time deep audit + roadmap (~$750)**~~ — not on the final sheet.
- ~~**Starter (~$500–750/mo)**~~ → became **Care** ($495 local / $795 B2B).
- ~~**Growth (~$1,500/mo)**~~ → became **Local SEO** ($1,200) / **Pipeline** ($2,500).
- ~~**Scale ($3k+/mo)**~~ → became **Local SEO + Growth** ($2,400) / **Growth
  Partner** ($4,500).

**Contract terms (load-bearing — SEO lags, so this protects retention):**
- **6-month minimum on all retainers.** Tied deliberately to the results ladder:
  it's how long the lagging metrics (traffic/leads) take to move. Shorter =
  guaranteed disappointed client. *(Still true; not yet enforced in code —
  see `TODO.md`.)*
- **Prepay 6 months → 1 month free (or ~10–15% off).** Proposed here; **not on
  the final sheet** — confirm with Owen before quoting it.
- After the initial term → month-to-month (they stay because it works).
- **Tie tier caps to fix-generation volume** — that's the only expensive part
  and the natural upgrade lever. Monitoring/audits can be ~unlimited. *(The
  final sheet meters pages/content pieces per month instead; quotas are declared
  in `lib/tiers.ts` but not yet enforced.)*

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
- **2026-08-25d (manual job scheduling for any client — VERIFIED)** — Owen:
  entitlements are guidance, not a hard gate — he needs to schedule/run jobs
  for clients that aren't onboarded yet (no tier). Added `admin_added` to
  `scheduled_jobs` (**same pending migration**, `migrate_2026-08-25d_...sql`,
  now two flags): hand-scheduled rows live outside the entitlement contract —
  reconcile never disables them, and they can be deleted outright
  (plan-provisioned rows still only ever disable). /jobs page: selecting a
  specific client always shows their card (even zero jobs / no tier) with an
  "Add a job… + cadence + Schedule" control (implemented handlers only);
  manual rows get a "manual" badge + delete button. Routes:
  `POST/DELETE /clients/:id/automation/jobs[/:jobId]`,
  `GET /overview/jobs/types`. Duplicate add re-enables the existing row
  (unique index) instead of erroring. Also hardened reconcile: a transient
  null from getClientById used to read as "wants no jobs" and mass-disable a
  healthy client's rows (probable cause of Sweet Additions showing all-jobs-
  disabled on 2026-08-25) — desiredJobsFor now throws on lookup failure and
  reconcile skips that client for the sweep. Verified live on a no-tier
  throwaway: add → run-now ok → duplicate-add re-enables → bad type rejected;
  pre-migration reconcile still disables the manual row (expected — flags
  aren't sticky until migration d runs), cleanup clean. Sweet Additions'
  non-sticky disables self-heal at the next reconcile sweep.
- **2026-08-25c (four-engine GEO — LIVE-VERIFIED, bullet flipped)** — Owen set
  `PERPLEXITY_API_KEY` (local .env; **still needs setting on Render**). Full
  4-leg run on a throwaway client, cleaned up after: generic query → not
  mentioned anywhere, Perplexity + AI Overview both returned real competitor
  citation lists (semrush.com et al); brand-adjacent Tampa query → mentioned
  on ALL FOUR engines, with Perplexity's native citations including
  hyperboledigital.com itself (domainCited=true) plus the local-competitor
  set (alldigitalgroup.com, digitalneighbor.com, …) — exactly the
  "who's getting cited instead" input. GEO tier bullet in `lib/tiers.ts`
  flipped to `built: true`. Per handoff #2 §0.2, the $1,200 hold-until-GEO
  condition is now met — repricing unblocked, Owen's call.
- **2026-08-25b (per-client job opt-outs + post-migration verification, LIVE-VERIFIED)** —
  Owen's ask: per-client control over which jobs run ("some jobs may need to
  run and some might not based on customer"). Root problem: the hourly
  reconcile sweep treated entitlements as authoritative and RE-ENABLED any
  manually disabled job within the hour, so the disable toggle couldn't
  express a deliberate per-client opt-out.
  - `scheduled_jobs.admin_disabled` (**⚠️ run `migrate_2026-08-25d_job-admin-disabled.sql`**):
    disabling from the UI sets it (reconcile leaves the row alone); enabling
    clears it and reschedules via computeNextRun so a stale next_run_at can't
    fire instantly. Entitlement-removal disables still don't set the flag.
    Admin-disabled jobs are excluded from the "entitled but not scheduled"
    warning — that warning is for gaps nobody chose. Code tolerates the
    missing column pre-migration (falls back to non-sticky toggling).
  - /jobs page: client selector dropdown + per-job Enable/Disable buttons
    (calls the same per-client toggle route as the SEO-page Automation card);
    "disabled (by you — stays off)" badge distinguishes deliberate opt-outs.
  - **Post-migration verification of the 2026-08-25 handoff-#3 work ran clean**
    (migrations a–c applied by Owen; throwaway client, real crawl, cleaned up):
    crawl job recorded real cost (4.5¢) in job_runs; fix_verify round-trip —
    fake done llms.txt fix → `regressed_at` (hyperbole still has no llms.txt),
    clean titles fix → `verified_at`; `visibility_runs.cited_domains` persists
    (google_aio stored semrush.com et al); fake unanswered question → real
    Haiku brief with outline, question → `briefed`; budget gate at 1¢ →
    `budget_exceeded`, no paid call. Bonus: Owen's locally running dev API
    picked the throwaway's due jobs off the shared DB mid-test and ran the
    new handlers via the dispatcher — CAS claiming and job_runs bookkeeping
    confirmed on the real tick path, not just run-now.
  - Still pending: `PERPLEXITY_API_KEY` (Owen fetching it) → live 4-leg
    visibility run → flip the GEO bullet in tiers.ts. Brief→draft→publish→KB
    loop verified through `briefed`; the publish half still needs a real
    Framer-connected run.
- **2026-08-25 (handoff #3 — SEO+GEO delivery loop: phases 0–6 built, partially
  live-verified)** — Closed the gaps between "every tool exists" and "the month
  runs itself." **⚠️ THREE MIGRATIONS to run before deploy** (in order):
  `migrate_2026-08-25_job-runs.sql`, `migrate_2026-08-25b_seo-fix-tracking.sql`,
  `migrate_2026-08-25c_geo-content.sql`. Everything degrades gracefully
  pre-migration (verified), but budgets/cost history/fix-verify/briefs are
  inert until they run.
  - **Phase 0 (pricing)** was already shipped 2026-08-18 by handoff #2 —
    verified live: Sweet Additions resolves to `care`, three-tier catalog +
    legacy key/price maps intact. Nothing touched.
  - **Phase 1 (scheduler gaps)** — `job_runs` audit table (cost per run,
    'running' rows swept to failed after 30min), per-client monthly paid-job
    budget (`portalConfig.jobBudgetCents`, default $5; sums real
    `job_runs.cost_cents`; fail-closed on read errors, fail-open ONLY when the
    table predates its migration; superadmin run-now bypasses), cost recorded
    per handler (crawl = real DataForSEO cost; SERP 0.2¢/kw + visibility
    1¢/leg are deliberate overestimates). New `fix_verify` (day 3) +
    `content_brief` (day 2) jobs provision for seo-entitled clients;
    visibility_poll upgraded to weekly on the seo tier. Superadmin
    **Automation card** on the client SEO page (per-job status/cost, run-now,
    toggle, budget editor, run history) + "Last audited" stamp under the
    audit. **Found + fixed a real provisioning bug:** `desiredJobsFor` gated
    on `entitlements.planKey` (Stripe-only), so a tier-ASSIGNED client with no
    Stripe subscription — i.e. every newly onboarded client — got ZERO jobs;
    now gates on `tierForKey(client.tierKey) || planKey`. Live-verified on a
    throwaway seo client: 8 jobs provisioned, rank_check run-now →
    `setup_incomplete` (no spend), unimplemented handler fails loudly,
    budget defaults honored, cleanup left no orphans.
  - **Phase 2 (setup checklist)** — `lib/setup-status.ts` computes (never
    stores) the 5 core gates (GSC live-fetch, ≥5 keywords, ≥3 visibility
    queries, brand terms, baseline crawl) + conditional local/content items;
    `GET /:id/setup-status` (superadmin + entitled client); collapsible
    SetupBanner on the SEO page linking each red item to its config screen.
    rank_check/visibility_poll now report `setup_incomplete` instead of
    erroring when prerequisites are missing. Live-verified (5 red on a fresh
    client; Spec-ID shows 4). NOT built: the red count badge on the
    superadmin client list (would live-fetch GSC per client on list load —
    needs a cheaper variant).
  - **Phase 3 (This-month panel)** — `lib/month-summary.ts` +
    `GET /:id/month-summary?month=YYYY-MM` (attention[] stripped for
    clients); `MonthSummaryCard` leads ClientHome for seo-entitled clients
    (wins-first framing, month picker, per-provider visibility, keyword
    movers, "who's getting cited instead", quota, unanswered questions,
    superadmin attention list). `change_requests.source`
    ('client'|'seo_fix') + `fix_meta` set by all three fix creators.
    Report email extended: keyword movers, per-provider visibility, content
    published, verified-fix count, unanswered-question count — old stored
    reports still render (all new fields optional). Live-verified against
    Spec-ID (real July post + keywords rendered; graceful empty state on a
    bare client; pre-migration column absences degrade to warnings).
  - **Phase 4a (four engines)** — `lib/visibility.ts` now runs
    openai/anthropic/perplexity/google_aio, each leg skipped (logged) when
    unconfigured. Perplexity via `sonar` (`PERPLEXITY_API_KEY` — **NOT YET
    SET; Owen must add it**, leg is built but unverified). Google AI
    Overviews via the existing DataForSEO SERP subscription
    (`load_async_ai_overview` on the same endpoint as rank checks) —
    **LIVE-VERIFIED**: real overview text + cited domains for "what is
    technical seo" (semrush.com et al), correct no-overview signal for a
    local query (recorded as skip, not mention=false, so the rate isn't
    polluted). Native citations stored in `visibility_runs.cited_domains`
    (insert falls back pre-migration); dashboard visibility tab: per-provider
    % cards + "Who's getting cited instead". **GEO tier bullet stays
    `built: false`** until the Perplexity leg is live-verified with a real
    key.
  - **Phase 4b (questions → briefs)** — `chat_unanswered_questions`
    (orchestrator's low-confidence path now upserts fire-and-forget;
    `seedUnansweredFromHistory` backfills 90 days of message_logs on first
    brief run) + `content_briefs` tables; `generateBriefs` (Haiku, N = tier
    quota min 1, + up to 2 unranked target keywords, idempotent per month)
    wired as the `content_brief` job; routes `GET /:id/content/briefs`
    (entitled clients read) + superadmin `POST .../briefs/:id/draft` →
    existing draftPost flow, brief marked drafted; on PUBLISH the source
    question flips to `answered` and the Q&A is added to the chatbot KB via
    `addDocument`. BriefsCard on the Content page. **Not live-verified**
    (blocked on migration c) — verify post-migration: fake unanswered
    question → brief → draft → publish → question answered + KB doc exists.
  - **Phase 4c (quotas)** — `transitionPost` blocks publishing past the
    tier's `contentPiecesPerMonth` (clear message; superadmin `overrideQuota`
    honored on both the status PATCH and the Framer publish route); month
    summary surfaces quotaUsed/quotaCap. `pagesPerMonth` NOT enforced —
    there's no countable "optimized page" object yet; bullet stays false.
  - **Phase 5 (fix verification)** — `verifySeoFixes` in seo-fixes.ts:
    every done `seo_fix` request compared to the latest finished crawl
    (checkKeys×URLs; `llms_txt` pseudo-key reads aiSearch.hasLlmsTxt; fixes
    done after the crawl wait for the next one) → sets
    `verified_at`/`regressed_at`; wired as the `fix_verify` job (free).
    Month summary's issuesFixed counts VERIFIED only; regressions surface in
    attention[]. Schema fixes have no crawl check → `unverifiable`, stay
    manual. **Not live-verified** (blocked on migration b) — verify with a
    real title fix + re-crawl on hyperboledigital.com.
  - **Phase 6 (report send)** — **deliberate semantics change over handoff
    #2:** the scheduled report path (health_report job + legacy interval) is
    now DRAFT-ONLY — generates, claims the period as 'drafted', and posts a
    Slack nudge to `SUPERADMIN_SLACK_WEBHOOK`; email leaves only on a
    superadmin click (the existing guarded `sendReport`, or the run-now
    route which passes `sendEmail: true`). This implements handoff #3's
    "generation scheduled, sending manual" guardrail; Owen should confirm he
    wants drafts-not-sends (flip is one option flag if not). PDF attachment
    on send NOT built — no server-side report PDF exists (the jspdf audit
    PDF is dashboard-side and audit-shaped).
  - Typechecks clean across the workspace after every phase. All throwaway
    verify clients deleted. **Post-migration verification list:** budget
    skip at 1¢, job_runs rows w/ real crawl cost, fix-verify round-trip,
    brief pipeline end-to-end, Perplexity leg once the key lands (then flip
    the GEO bullet).
- **2026-07-21 (offer-sheet audit → tiers, Site Health, Local Presence)** — Owen
  supplied the finalized Local Services + B2B offer sheets as a PDF and asked for
  a gap report against the codebase. Three things shipped off the back of it; the
  full remaining gap list is in `TODO.md` (authoritative), not duplicated here.
  - **The pricing section above is now superseded** — see the banner. Real tiers
    live in `lib/tiers.ts`, hardcoded with no Stripe products (Owen's call: the
    sheet may still change). A tier is a third entitlement source alongside
    add-ons and comps; verified that a paid add-on correctly outranks it.
  - **Site Health** (uptime + SSL, on-demand) and **Local Presence** (42-directory
    citation tracker with NAP-drift detection + GBP activity log, both
    hand-maintained) built and live-verified against throwaway clients.
  - **Directly relevant to this plan:** the sheets promise AI citation tracking
    across **ChatGPT, Perplexity, and Google AI Overviews**. `lib/visibility.ts`
    covers **OpenAI + Anthropic only**. Perplexity/Google-Extended appear in
    `lib/ai-search.ts` purely as robots.txt bot names — that's crawler-blocking
    detection, *not* citation tracking, and it's easy to mistake one for the
    other. The GEO bullet on both mid tiers is flagged `built: false` until the
    two missing engines are actually tracked. **This is the highest-value
    remaining item on this plan's Phase 4 (GEO layer).**
  - **Ads management deliberately deferred** (Owen, 2026-07-21). Worth knowing
    it's a billing-architecture problem, not a dashboard one — see `TODO.md`.
- **2026-07-16 (@mention notifications on request comments — off-plan, requested
  directly)** — Not part of the SEO plan; logged here anyway since it's the same
  session/checkpoint discipline. Owen also caught a real bug while discussing
  this: comment authors always showed the hardcoded label "Hyperbole Digital" or
  "You" (`requests-table.tsx` line ~158) instead of the real signed-in user's
  name — the app tracked `isSuperadmin` boolean + Clerk userId but never a
  display name.
  - New `lib/users.ts`: `getDisplayNames()` (batched, cached Clerk
    `getUserList`), `getUserEmail()`, `getMentionableUsers(clientId)` (Hyperbole
    team from `SUPERADMIN_USER_IDS` + the client's Clerk org members via
    `getOrganizationMembershipList`). Verified live against real Clerk data —
    resolved the actual profile name ("Hyperbole"), not a hardcoded string.
  - `change_request_comments` gains a `mentions text[]` column
    (`migrate_2026-07-16_comment-mentions.sql`) — populated by explicit picker
    selection in the compose UI, NOT parsed from free text, so notifying the
    right person is reliable.
  - `addComment` now emails each mentioned person individually via the existing
    `sendGuardedEmail` guardrail path (test-mode/cap/logging all still apply —
    no new send path invented). `listComments`/`getRequestDetail` resolve real
    author names.
  - Route: `GET /:id/mentionable-users`. Frontend: `MentionComposer` in
    `requests-table.tsx` — typing "@" opens a dropdown of real mentionable
    people, picking one inserts "@Full Name" and tracks their Clerk ID
    separately from the text (mentions sent = only those whose "@Name" is still
    present in the text at submit, protecting against a stale ping); comment
    bodies bold "@Name" occurrences; author label now shows `authorName`.
  - **2026-07-16 LIVE-VERIFIED end-to-end.** Migration applied. Created a real
    test request on Spec-ID, posted a comment mentioning the Hyperbole account,
    confirmed: comment saved with `mentions: [userId]`, real author name
    resolved, and a `comment.mention` email logged + sent (guarded, test-mode
    redirected to the test inbox) within 2s of the comment. Test request
    cascade-deleted afterward (comments/events went with it). Feature is DONE.
- **2026-07-16 (Sitemap check added; frontend error-swallowing bug fixed)** —
  Owen asked whether sitemap checking existed (it didn't — noted gap from
  earlier). Added to `lib/ai-search.ts`: `checkSitemap()` reads `Sitemap:` lines
  from robots.txt (falls back to `/sitemap.xml`), validates it's real XML, counts
  `<loc>` entries. Wired into `checkAiSearch` (score now 80% bots / 10% llms.txt /
  10% sitemap present) with new issues (missing sitemap = medium; found but not
  referenced in robots.txt = low). Verified: hyperbole found (13 URLs, referenced),
  nytimes found (622 URLs). No cost, no migration (rides the existing `ai_search`
  jsonb column).

  Separately: while investigating an unrelated Framer-publish 400 error Owen hit,
  found and fixed a real bug in `apps/dashboard/src/lib/api.ts`'s `request()` —
  it discarded the server's actual JSON error message and always threw a generic
  "API error: {status}", hiding real causes from the UI. Now reads `body.error`
  when present. The underlying publish failure itself is still unconfirmed —
  waiting on Owen's API server terminal output; likely candidate per HANDOFF.md
  is the known "Framer collection/field IDs are not stable" issue.
- **2026-07-15 (Direct PDF download — replaced print flow)** — Per Owen: no print
  dialog, just download. Added `jspdf`; `lib/audit-pdf.ts` builds a branded PDF
  directly from the crawl data (crisp/selectable text, not a screenshot) via
  `buildAuditPdf(crawl)` (testable) + `downloadAuditPdf(crawl)` (saves
  `SEO-Audit-<domain>-<date>.pdf`). Audit Tool "Download PDF" buttons (active +
  recent rows) call it — one click, instant download. Removed the print page +
  `/audit-report/:crawlId` route. Smoke-tested in Node (valid 6KB PDF) and
  visually confirmed: gold-accent header, two score boxes, severity pills,
  explanations, affected-URL bullets, footer. Uses shared `lib/audit-rows.ts`.
  Email-to-prospect still deferred (582-email guardrail).
- **2026-07-15 (Check-list overhaul + score-card redesign)** — Dumped DataForSEO's
  full On-Page vocabulary (57 checks) and rebuilt `PROBLEM_CHECKS` (~40 real
  problem checks). Fixed two real bugs the audit surfaced: (1) a FALSE POSITIVE —
  we flagged `seo_friendly_url_characters_check` as "unfriendly URLs" but that key
  is `true` when the URL PASSES, so we were reporting good URLs as broken;
  (2) several MADE-UP keys that never fired — `duplicate_description` (real key is
  `duplicate_meta_tags` — this is why we missed the duplicate-meta-descriptions
  SEMrush caught), `duplicate_h1_tag`, `broken_links`, `broken_resources`,
  `duplicate_content`, `redirect_loop`. Added ~15 real checks (duplicate_meta_tags,
  canonical_chain/to_redirect/recursive, redirect_chain, has_meta_refresh_redirect,
  is_orphan_page, low_character_count, no_encoding_meta_tag, size_greater_than_3mb,
  flash, etc.). Updated TITLE_DESC_KEYS (both files) to duplicate_meta_tags. Score
  cards redesigned (label on top, `NN /100` inline, progress bar — the stacked
  "/100 under the number" looked odd). **Known gaps DataForSEO On-Page can't cover
  (SEMrush does):** hreflang/international SEO, SSL cert details, sitemap.xml
  validation, mobile viewport. Some (viewport, sitemap presence) are cheap to add
  ourselves later — see next.
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

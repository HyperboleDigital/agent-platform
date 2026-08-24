# TODO

## Fulfillment automation (handoff #2) — in progress 2026-08-19

**⚠️ RUN THIS MIGRATION** in the Supabase SQL editor before the jobs system
works: `supabase/migrate_2026-08-19_scheduled-jobs.sql` (scheduled_jobs table).
Until it runs, the dispatcher and reconcile sweep log errors on every tick
(harmless, but noisy) and the Jobs view 500s.

Done so far (§0 + §1 of the handoff):
- Nav entitlement rule, enforced in ONE place (ClientNav): clients only ever
  see service sections they're entitled to — no locked/teaser items. Leads is
  now gated on `chat` (leads only exist via the chat agent's CRM tool — it was
  leaking to non-chat clients). Superadmins see everything, lock glyph = "this
  client doesn't have this".
- SEO tier display name → "SEO + GEO" (key stays `seo`). Price unchanged at
  $1,200 — do NOT raise until the §3 GEO work ships.
- scheduled_jobs infra: one dispatcher (60s tick, CAS-claim on next_run_at so
  concurrent instances can't double-run), handlers registered by job_type in
  lib/scheduled-jobs.ts, hourly + startup reconcile sweep, inline reconcile on
  every tier transition, add-on change, comp grant/revoke.
- Handlers wired to real deliverables: uptime_check, crawl, rank_check,
  visibility_poll, gsc_sync, ads_sync, health_report (delegates to the
  claim-guarded report-scheduler — duplicate-send-safe), gbp_post (verifies a
  post was LOGGED this week — it's a human task; the job monitors the
  obligation). Not yet implemented (fail loudly by design): local_pack_check,
  chat_metrics_rollup, unanswered_digest.
- Superadmin Jobs view at /jobs: per-client job status, failed runs visible,
  run-now, reconcile button, and the entitled-but-not-scheduled warning.
- Deviation from the handoff table, deliberate: chat_metrics_rollup +
  unanswered_digest key on the `chat` ENTITLEMENT, not the Growth tier, so a
  chatbot-at-Care client (comp) gets them too — their report needs the chat
  block. Care also keeps a monthly visibility_poll (the "0 of N citations"
  line in report block 2 needs data).
- The handoff says "worker on Railway" — the platform deploys on RENDER, and
  the dispatcher runs in-process in the API (same pattern as the existing
  report/site-monitor intervals). At current scale a separate worker is
  overhead; revisit only if job runtime starts starving request handling.
- Legacy overlap, intentional for now: the old hourly report interval AND the
  health_report job both call deliverMonthlyReport. The DB claim row makes
  double-send impossible. Retire the legacy interval once the jobs system has
  a month of clean runs.

Next per the handoff order: Care report blocks + review queue (§2.2), GEO
tracking gaps (§3.1), SEO+GEO report (§2.3), content pipeline (§5).


Working list of what's next / unfinished. Owen reviews and edits this
directly — treat entries here as authoritative over anything a session
summary elsewhere implies.

## Active initiative → see `docs/plans/`

Two approved living plans drive the roadmap. Full detail + running checkpoints
live in the plan docs; this is just the pointer:

- **`docs/plans/seo-automation.md`** — **live and working**, not just planned:
  DataForSEO crawl → /100 site-health score + AI-Search-Health (GEO) score
  (bot-blocking, llms.txt, sitemap.xml, all checked) + severity-ranked issues
  with affected URLs → one-click AI-generated fixes (titles/meta, schema
  JSON-LD, llms.txt) delivered as change requests → downloadable branded PDF
  report → rolled into client monthly Reports. Superadmin-only Audit Tool can
  crawl ANY url on demand (prospect audits). Everything is **manual-trigger
  only, by explicit choice** — no scheduler, no public/automatic runs.
  Costs ~$0.002/page (DataForSEO) — watch the account balance.
- **`docs/plans/website-rebuild.md`** — automated Framer rebuild of a client's
  old site (control = frictionless SEO + lock-in). Desk-research feasibility
  spike done (Framer 3.0 Server/Canvas/Plugin APIs + MCP look viable); the
  hands-on spike (build real pages on a throwaway Framer project) is still
  pending — needs a throwaway Framer project + credentials from Owen.

## Shipped 2026-08-18 (pricing restructure) — NEEDS SETUP TO GO LIVE

The six Local/B2B tiers collapsed into one ladder (Care $495 / SEO $1,200 /
Growth $2,500), Local Presence became a $250/mo add-on, and every client's
deal is now tier template + custom line items (`client_line_items`,
`lib/line-items.ts`), rendered on a superadmin **Info sheet** view
(`/clients/:slug/info-sheet`). Chatbots persist at Care via a comp grant on
downgrade (`lib/tier-transitions.ts`) with a quiet "live but unmanaged" notice.
`clients.hosting` ('us' | 'client') models who owns the platform — client-hosted
sites lose the hosting bullet + Site Health card, and their default retainer is
the chatbot, not Care. MRR now sums tier + add-ons + monthly non-included line
items (one place: `lib/line-items.ts`, used by both Overview and the sheet).

**DONE:** both migrations are applied to the live DB (verified 2026-08-18 —
`clients.hosting` present, every `tier_key` resolves in the new catalog,
`client_line_items` queryable). No client was on an old tier in a way that
needed a manual Stripe move — Owen confirmed no real clients on those plans.

Live-verified the same day: on a throwaway billing client, a $300/mo line item
moved both client MRR and platform MRR by exactly $300, while an `included`
$150/mo item and a $5,000 one-time item moved neither; the info sheet's monthly
total and the MRR figure agreed exactly. On the comped test client (Spec-ID),
line items correctly contributed $0. Throwaway rows deleted, no orphans.

**Stripe wiring: DONE in TEST mode (2026-08-18), NOT in live mode.**

Rather than create three redundant products, the tiers **adopted** the existing
prices whose amounts already matched, and the products were renamed to fit the
new ladder:

| Tier | Price ID | Adopted from | Product renamed |
|---|---|---|---|
| Care $495 | `price_1TwsIRJvRTpaT0Wry7AmJQEH` | old local-care | — (already "Care") |
| SEO $1,200 | `price_1TwsNiJvRTpaT0WraMbNDyKu` | old local-seo | "Local SEO" → "SEO" |
| Growth $2,500 | `price_1TwsTLJvRTpaT0Wrg8a9dBpH` | old b2b-momentum | "Momentum" → "Growth" |
| Local Presence $250 | `price_1U5u81JvRTpaT0WrehTuxHXU` | newly created | new "Local Presence" product |

All four are set in `apps/api/.env`. Side benefit of adopting rather than
recreating: Sweet Additions' existing $495 subscription is now on the
**canonical** Care price, so nothing needed migrating and the deal-vs-Stripe
mismatch check compares equal. The old `LOCAL_GROWTH` ($2,400) and `B2B_GROWTH`
($4,500) prices were deliberately NOT adopted — wrong amounts for the new sheet.

Verified live: all three tiers round-trip through `tierForPriceId`, all six
legacy price IDs still resolve to their consolidated tier, Local Presence is
`available`, and payment links now generate for all three tiers (they were
refusing before). Any cached payment link from the retired catalog was cleared
off the adopted prices, so the next "Copy payment link" mints a fresh one.

- Leave the legacy `STRIPE_PRICE_TIER_LOCAL_*` / `_B2B_*` vars set — the
  deprecated reverse-lookup depends on them for any old subscription.

### Going live with pricing (runbook)

`pnpm --filter api setup-stripe-pricing` creates/adopts all four products +
prices and prints the env lines. It is **create-only** — it never renames,
archives, or re-prices an existing Stripe object, and it's idempotent (objects
are tagged `metadata.tier_key` / `metadata.service_key`, which is how a rerun
finds them). Verified against test mode: adopts all four, creates nothing.

For live mode, pass the live key on the command line so it never lands in a
committed file:

```
STRIPE_SECRET_KEY=sk_live_... pnpm --filter api setup-stripe-pricing
```

Then set the four printed vars in the **Render dashboard** → Environment
(Render env vars are UI-managed, not committed — see HANDOFF.md).

Pass `--with-webhook` (needs `API_PUBLIC_URL`) to also create the hosted
webhook endpoint and print its signing secret. Stripe reveals that secret
**only at creation** — copy it straight into Render; if the endpoint already
exists the script says so and leaves it alone (roll the secret in the
dashboard to get a new one).

**⚠️ Switching Render from the test key to a live key is a billing-account
migration, not just an env change.** Two things that bite:

1. **There is no hosted webhook endpoint at all — verified 2026-08-18, the
   account has ZERO webhook endpoints in test mode.** Render's
   `STRIPE_WEBHOOK_SECRET` is almost certainly a leftover from
   `stripe listen` (the CLI's local-forwarding secret), which corresponds to
   no hosted endpoint. **Production has therefore never synced a Stripe
   event**: paying a payment link would charge the card, but
   `checkout.session.completed` never arrives, so `attributeCheckoutToClient`
   never runs, the subscription is never attributed, and `tier_key` never
   syncs — the dashboard would show nothing happened. No harm done so far
   (no real client has ever paid), but this must be fixed before taking a
   single real payment. `--with-webhook` above creates it.
2. **Existing test-mode subscriptions become phantoms.** ✅ Handled
   2026-08-18: Sweet Additions' test-mode sub was marked comped
   (`stripe_customer_id='comped'`, `stripe_subscription_id` cleared — it
   referenced a test object that doesn't exist under the live key). They keep
   dashboard access and their Care plan label (`stripe_price_id` deliberately
   kept so the plan still renders via the legacy price map); platform MRR went
   $495 → $0, which is the truthful number since live Stripe collects nothing
   from them. **When they actually start paying, send the live Care payment
   link** — the webhook will attribute it and flip them off comped. Prior
   values if this ever needs reversing: customer `cus_Uyfc4JEjRDccpL`, sub
   `sub_1TyiHGJvRTpaT0Wrh64xsDlf`.

### PRODUCTION IS ON LIVE STRIPE as of 2026-08-18

Render's `STRIPE_SECRET_KEY` is now `sk_live_`, with the three tier price IDs,
`STRIPE_PRICE_LOCAL`, and a real hosted webhook endpoint + its signing secret.

**`STRIPE_PRICE_SEO` / `STRIPE_PRICE_CONTENT` need NOTHING done — leave them.**
(This reverses an earlier instruction in this session to create live prices for
them. That was wrong; see below.)

**seo / content / chat are now `tier_only`** (changed 2026-08-18). Their $499 /
$799 / $0 fields are retired amounts from the pre-tier à-la-carte model and are
**not on the current pricing sheet** — SEO is a $1,200/mo tier and content comes
with Growth at $2,500. While they sat at `status: 'available'`, restoring the
marketplace put a 60%-off, off-sheet SEO price one click from being sold, and
the locked-section screen quoted a superadmin "$499 / month · Add to plan" for
something the sheet prices at $1,200. `priceId` is deliberately KEPT on all
three so any legacy subscription item still resolves via `serviceForPriceId` —
they just can't be sold at those prices. Chat additionally stopped rendering as
"Coming soon" to clients, which it had been doing for a shipped, live product
whenever `STRIPE_PRICE_CHAT` was unset; its real commercial line is the
one-time Chatbot Setup fee, which is a per-deal line item, not a service price.

Net effect: **Local Presence $250/mo is the only à-la-carte add-on**, matching
the sheet exactly. `LockedSection` and the marketplace card both gate on
`status === 'available'` (plus a real flat price, which also keeps Paid Ads out
of a one-click "Add" it can't support). `setup-stripe-pricing` skips
`tier_only` services so it can never mint off-sheet prices — it targets the
three tiers plus Local Presence, nothing else.

Verify in production: send a test webhook from the Stripe dashboard (expect
200), and click "Copy payment link" for each tier in the production dashboard.

Other notes:

- Custom deals: assign tier → add line items → "Create custom Stripe
  subscription" (invoice-billed, `send_invoice`); one-time items via "Invoice
  one-time items" (idempotent per item). Payment links still cover vanilla
  single-tier deals.
- The chat-at-Care downgrade path has NOT been exercised live (no client is on
  a chat-including tier). Test it deliberately on Spec-ID — assign Growth, drop
  to Care, confirm the comp grant appears and the "live but unmanaged" notice
  renders — before a real client ever downgrades.
- The GEO bullet stays `built: false` — visibility still tracks OpenAI +
  Anthropic only; packaging changed, coverage didn't.

## Offer-sheet gaps (from the 2026-07-21 PDF audit)

The finalized offer sheets (Local Services + B2B, three tiers each) were audited
against this codebase on 2026-07-21. Tier definitions now live in
`apps/api/src/lib/tiers.ts`; each bullet carries a `built` flag so the dashboard
never implies a feature is live when it isn't. **When you build one of the items
below, flip its bullet to `built: true` in that file** — otherwise paying clients
keep seeing it as "coming to the dashboard."

**Deliberately deferred — do NOT build without Owen saying so:**

- **Ads management (Google / Meta / LinkedIn) + the spend-tiered fee.** On both
  sheets as add-ons ($750/mo flat to $5k spend then 15% above; B2B $1,000/mo to
  $10k then 12%). **Not shipping yet — Owen's call 2026-07-21.** Note for
  whoever picks this up: this is a *billing-architecture* problem, not just a
  missing dashboard. `ServiceInfo` carries a flat `monthlyPriceCents` only,
  there's no metered/usage Stripe component anywhere, and nothing reads ad spend
  from any platform. Expressing "flat fee up to $X, then Y% of spend above"
  needs a real usage-based billing design plus a Google Ads / Meta API
  integration — budget accordingly, it is not a small ticket.

**Deferred UI — add-on marketplace (removed 2026-07-24):**

- The **Services** section on the client Billing tab (the à-la-carte add-on
  marketplace: SEO $499, Content $799, plus Local/Reviews/Social) was **removed
  from the dashboard** (`ServicesCard` in `ClientDetail.tsx`). Reason: the model
  is now tier-first (tiers bundle seo/content/local via `includes[]`), and the
  section was showing `coming_soon` services (Reviews, Social) with a working
  "Comp" button — i.e. granting access to things that have no Stripe product and
  don't ship yet. Nothing on the backend was touched: the `/billing/services`,
  add-on, and comp-service routes, the `services.ts` catalog, and entitlement
  resolution all still work — this was a UI removal only, restorable from git
  (this commit). Bring it back if/when à-la-carte add-ons become a deliberate
  offering with real Stripe products for the currently-`coming_soon` ones.
  (Cleaned up the leftover test-client comps for `reviews`/`social` at the same
  time, since the UI that managed them is gone.)

**Real gaps, not yet started (biggest first):**

- **Competitor + keyword rank tracking / map pack** — promised on Tier 2 of both
  sheets. Needs a paid SERP API; evaluate DataForSEO's Rank Tracker first (see
  the deferred item below).
- **AI citation tracking is only ⅓ built** — the sheets promise ChatGPT,
  Perplexity *and* Google AI Overviews. `lib/visibility.ts` covers OpenAI +
  Anthropic only. Perplexity and AI Overviews appear in `lib/ai-search.ts` only
  as robots.txt bot names, which is crawler-blocking detection, NOT citation
  tracking — easy to mistake for coverage.
- **Review generation + response management** — the `reviews` service is still
  `coming_soon` with no implementation. Needs Google Business Profile API access
  (a manual Google approval request). A manual review tracker was deliberately
  skipped as busywork; the valuable half is response management, which needs the API.
- **Call tracking + lead attribution** (Tier 3 local), **CRM integration**
  (Tier 3 B2B) — nothing exists; `leads` has no source attribution.
- **Link building / digital PR tracking** (Tier 3 both).
- **Content/page quotas are not enforced** — tiers declare `quotas` in
  `lib/tiers.ts` (1/3/3/6 per month) but nothing counts against them.
- **Change-request SLA** — Care tier sells "1–2 business day turnaround, one
  active request at a time." Neither the turnaround clock nor the
  one-active-at-a-time limit is enforced.
- **Email nurture sequences + lead scoring** (B2B Tier 3) — ⚠️ **this collides
  with the 582-email guardrail.** Nurture sequences are by definition
  scheduler-driven automated sending. Needs an explicit decision from Owen
  before it's built, not just a build ticket.
- **Campaign landing pages** ($1,500 local / $2,000 B2B) and **per-unit
  purchases** (additional page $600, content piece $500) — only monthly
  subscriptions exist today.
- **6-month minimum term** — no commitment/term enforcement in the Stripe code.
- **No real Stripe products for the pricing-sheet tiers** (`clients.tier_key`,
  set via the Billing tab's "Pricing-sheet tier" card) — it's a plain label,
  not a checkout, so it can silently disagree with the client's actual Stripe
  subscription (e.g. tier says "Local SEO $1,200/mo" while Stripe is really
  billing "Pro + add-ons $1,697/mo"). A superadmin-only mismatch warning was
  added 2026-07-24 (`ClientDetail.tsx` `BillingTab`) so this gets caught in the
  UI instead of silently drifting, but the two systems are still not the same
  object. Real fix is wiring Stripe products per tier — same item as the MRR
  gap below; do both together when the sheet is locked.

## Deferred from the Phase 4 plan (not started)

- **Scheduler** — intentionally NOT built. Owen has explicitly said every SEO
  run must stay manual for now (no auto-crawls, no auto-fix-generation, no
  public/automated audit surface). If/when this changes, the job-polling
  pattern in `lib/dataforseo.ts` (`startCrawl`/`refreshCrawl`) is the
  foundation to build a scheduler on top of. **Report/notification email must
  stay excluded from anything scheduler-reachable** — deliberate guardrail
  from the 582-email incident, not an oversight.
- **Google rank tracking via paid SERP API** — DataForSEO (already our vendor)
  also has a Rank Tracker/SERP API and a Backlinks API at the same low
  pricing; evaluate those first before any other vendor if real keyword-rank
  tracking becomes a priority (see the SEMrush-comparison discussion in
  `docs/plans/seo-automation.md`'s checkpoint log — our on-page audit already
  validated close to SEMrush's own numbers).

## Needs real-world setup before it does anything

- **Google Search Console connection** — ~~not set~~ **`GSC_SERVICE_ACCOUNT_JSON`
  is now set** (confirmed via `gscConfigured()` on 2026-07-22 — this note was
  stale). Still needed per-client: add that service account as a restricted
  user on each client's actual GSC property, and set `portalConfig.gscProperty`
  for them, or the Rankings section shows "Search Console not connected" for
  that client specifically (that's a per-client setup gap, not a global one).
- **Places API for GBP reviews** — `PLACES_API_KEY` is set. Still needed
  per-client: find the business's Place ID (Google's Place ID Finder tool)
  and set it in SEO → Configure, or the Reviews card on Local Presence shows
  a setup prompt for that client specifically.
- **Map-pack rank location per client** — `portalConfig.localLocation` (e.g.
  "Austin,Texas,United States") + `localKeywords` need setting per client in
  SEO → Configure for the Map pack ranking card to have anything to check.
- **PageSpeed Insights quota** — `PAGESPEED_API_KEY` is set and confirmed
  working (verified live against hyperboledigital.com), but it's on
  Google's free tier. Watch for quota exhaustion once real usage ramps
  up; upgrade if needed.
- **Anthropic account credit balance** — low/exhausted as of this
  session; the Anthropic leg of AI-visibility checks fails gracefully
  (OpenAI's leg still works) but isn't giving full two-provider coverage
  until credits are topped up. Pre-existing issue, not caused by Phase 4.
- **Framer connections per client** — the Framer publish pipeline is
  live-verified end-to-end (real publish + delete tested against
  Hyperbole Digital's own project), but each client needs their own
  connection configured in Billing → Content → "Connect" (project URL,
  API key, collection ID, field mapping) before their Content Engine can
  publish. Note: Framer collection/field IDs can change if the client
  restructures their CMS in the Framer editor — if publish starts
  failing with a "collection not found" error, re-run "Load collection
  fields" and re-save the mapping.
- **`SUPERADMIN_SLACK_WEBHOOK` / `SUPERADMIN_NOTIFY_EMAIL`** — both set
  and confirmed delivering (change-request notifications tested live).
  ~~`PLATFORM_SENDER_CLIENT_ID` currently points at Spec-ID's Gmail
  connection as a stand-in sender~~ — resolved 2026-08-08: platform email
  now has its own Gmail connection (`platform_gmail_token`, connected from
  Overview → Platform email sender), fully independent of any client
  record. `PLATFORM_SENDER_CLIENT_ID` no longer exists.

## Shipped 2026-07-26 (keyword research — SEMrush-style)

- **Keyword research / "Find keywords"** (`researchKeywords` in
  `lib/dataforseo.ts` via DataForSEO Labs `keyword_suggestions/live`, route
  `GET /:id/seo/keyword-ideas`, `KeywordResearchModal` in `Seo.tsx`). Answers
  the "how do I even choose which keywords to track?" gap: superadmin types a
  seed (prefilled from client industry), and it expands into long-tail ideas,
  each with **monthly search volume + keyword difficulty (0–100)**. Winnable
  ones (difficulty ≤30, volume ≥10) are highlighted green and sorted to the
  top; one-click **Track** drops a keyword straight into the Target Keywords
  tracker. Verified live: seed "web design tampa" → 1,600-vol variants at
  difficulty 10–32 (vs national "web design" ≈90), exactly the winnable local
  long-tail thesis.
  - **Local-focused v1 by design** (Owen's call). No competitor/ranked-keyword
    data or national-bias mode yet — deliberate scope cut; revisit for B2B.
  - **Volume/difficulty use US-national location** (`DEFAULT_ORGANIC_LOCATION`),
    same caveat as the organic rank check. City-level metrics = future.
  - **Track only feeds the organic Target Keywords tracker**, not the
    map-pack keyword list. Wiring research → map-pack keywords is a nice
    follow-up (they live in Local Presence config, separate storage).

## NEEDS MIGRATION RUN (2026-07-26)

- **`migrate_2026-07-26_seo-keywords.sql`** — creates `seo_target_keywords` +
  `seo_keyword_ranks`. **Not yet applied** — run it in the Supabase SQL editor
  (same as prior migrations; there's no automated runner). Until it's run, the
  Target-keywords card will error on load (tables missing).

## Shipped 2026-07-26 (keyword strategy tracker + Local Presence config split)

- **Target-keyword rank tracking** (`lib/seo-keywords.ts`,
  `checkOrganicRank` in `lib/dataforseo.ts`, `TargetKeywordsCard` in `Seo.tsx`,
  routes `GET/POST/DELETE /:id/seo/keywords` + `POST /:id/seo/keywords/check`).
  The strategic half of Rankings: superadmin adds the keywords a client wants
  to rank for; "Check rankings now" fetches the client's current Google
  *organic* position for each via DataForSEO `serp/google/organic/live`
  (~$0.002/keyword, explicit action, superadmin-only), stored as a snapshot so
  the card shows current position + change-since-first-check. Fulfills the
  `built: false` "keyword positions" line in `tiers.ts`.
  - **Organic check location is hardcoded to "United States"**
    (`DEFAULT_ORGANIC_LOCATION`). Per-client organic location is a deliberate
    future refinement — fine for national intent, worth revisiting for
    region-specific B2B clients.
  - **No per-row trend chart yet** — the `trend` array is returned by the API
    and stored, but the card shows current + delta only. A sparkline per
    keyword is a nice v2.
- **Retired the GSC clicks-snapshot chart** — the manual "Take snapshot"
  clicks-over-time chart (and its confusing button) is gone from the SEO page.
  The GSC data now shows only as the "Already ranking for" query table. Backend
  `snapshotGsc`/`getGscTrend` + the `/seo/rankings/snapshot` route are left in
  place (dormant, harmless) in case a scheduler ever wants them; nothing renders
  the trend now. `snapshotRankings` still exists in `api.ts` but is unused.
- **Local Presence config moved off the SEO page** (Owen's call, reversing the
  2026-07-25 fold-in). Place ID / map-pack keywords / search location now live
  in their OWN Configure modal on the Local Presence page (`LocalConfigModal` in
  `LocalPresence.tsx`), saved via `GET/PUT /:id/local/config` (gated on `local`,
  not `seo`). Removed those three fields from the SEO Configure modal and from
  the `PUT /:id/seo/config` route.
- **Business-name → Place ID lookup** (`searchBusinesses` in `lib/places.ts`,
  `GET /:id/local/place-search`) — the Local config modal has a "search your
  business" box (Places Text Search) so the operator picks their business from
  a list instead of hunting for a `ChIJ…` ID. Solves the "where do I find the
  Place ID" friction. Superadmin-only (spends Places API calls).

## Shipped 2026-07-25 (Local Presence automation)

- **Auto-pulled reviews** (`lib/places.ts`, `routes/clients.ts`
  `GET /:id/local/reviews`, `ReviewsCard` in `LocalPresence.tsx`) — rating,
  review count, and recent review text pulled live from Google's Places API
  (New) `places/{placeId}` Place Details endpoint. Needs only an API key
  (`PLACES_API_KEY`, now set) — unlike the gated Business Profile API, no
  Google approval process. 6-hour in-memory cache per Place ID to avoid
  hammering quota (reviews don't change fast). Set the client's Place ID in
  SEO → Configure to turn this on; shows a setup prompt otherwise.
- **Map-pack rank tracking** (`checkMapPackRank` in `lib/dataforseo.ts`,
  `GET /:id/local/map-rank`, `MapRankCard`) — checks the Google Maps 3-pack
  position for each configured keyword via DataForSEO's
  `serp/google/maps/live/advanced` (same account as the SEO crawls, no new
  vendor). Matches the client's listing by Place ID when set, else falls back
  to business-name matching (an approximation — set the Place ID for
  accuracy). Needs `portalConfig.localKeywords` + `localLocation` (city/state
  to simulate the search from), both set in the same Configure modal.
- **Decision: GBP posts stay agency-logged, photos/Q&A punted** — posts are a
  billed deliverable ("weekly posts" on the pricing sheet) so the manual log
  stays as agency proof-of-work. Photos/Q&A more naturally belong to the
  client (they're on-site / know the business), but a client-facing upload UI
  was explicitly deferred — only 1 test client exists, not worth building
  ahead of real demand. Revisit if/when client volume makes manual relay
  (client emails you a photo → you log it) actual friction.
- **Config location** — Place ID / map-pack keywords / search location were
  folded into the existing SEO Configure modal (Owen's call) rather than a
  separate Local Presence settings UI, even though they're a `local`-tier
  concern — reuses the one settings surface instead of duplicating the
  pattern. Saved via the existing `PUT /:id/seo/config` route (still gated on
  `seo` entitlement, not `local` — fine today since only superadmin edits it,
  but would need a second gate if a `local`-only client ever needs to self-edit).

## Shipped 2026-07-24 (tier billing — Stripe products + payment links)

- **Six pricing-sheet tiers are now real Stripe products** (Test mode), each
  wired to a price via env (`STRIPE_PRICE_TIER_*`) and `tiers.ts.stripePriceId`,
  with `tierForPriceId()` reverse lookup. Renamed the B2B mid tier
  `b2b-pipeline` → `b2b-momentum` / "Momentum" (Owen's call; no client was on the
  old key). Setup reference: the `stripe-tiers-setup` artifact.
- **"Copy payment link" on the client Billing tab** (superadmin) — picks the
  selected tier, returns a durable Stripe **Payment Link** for that tier's price
  (`getOrCreateTierPaymentLink`, created once and cached on the Stripe Price's
  metadata) with `?client_reference_id=<clientId>` appended. Send it to the
  client; when they pay, the webhook (`checkout.session.completed` →
  `attributeCheckoutToClient`) stamps `client_id` on the subscription, syncs it,
  and sets `clients.tier_key` to match — so the "Pricing-sheet tier vs Current
  plan" drift resolves itself once they pay. `planForSubscription()` now renders
  a tier subscription in the Current-plan card.
- **Model A** (tier = the subscription) — chosen. Non-destructive parts only.
- **Starter/Pro fully retired** (only the test client existed on them — Owen
  confirmed no live clients). Removed the `PLANS` map, `planForPriceId`,
  `listPlans`, `compClient`, the `/billing/plans` + `/billing/:id/comp` routes,
  the "Subscribe to Starter/Pro" cards, and `STRIPE_PRICE_STARTER/PRO` from env.
  `planForSubscription` (tier-only, null-safe) is now the single base-price
  resolver — repointed usage caps, entitlements `planKey`, and MRR to it, and
  the webhook now detects a tier price as the subscription base. **Assigning a
  tier via "Save tier" is the free/comp path** (grants the tier's entitlements
  with no charge, via the existing `source: 'tier'`); the tier payment link is
  the paid path. The one legacy artifact — the test client's Pro Stripe sub —
  was canceled in test mode and its mirror rows cleared, so nothing references
  Starter/Pro anywhere. An unrecognized/legacy price now resolves to null and
  the UI degrades gracefully (was a hard crash via a `data!.plan!` assertion —
  also fixed). Kept `createCheckoutSession` + `/billing/:id/checkout` dormant as
  generic infra (not Starter/Pro-specific) in case tiers ever want in-app
  checkout instead of payment links.

- **Phase 2 shipped — "cancel the old plan" prompt.** Paying a tier link creates
  a NEW subscription (Payment Links spin up a fresh Stripe customer each time),
  so switching tiers leaves the previous sub active → double-billing. The
  Billing tab now finds every active sub attributed to a client via Stripe
  Search on `metadata['client_id']` (`listClientSubscriptions`), flags any that
  isn't the tracked one as stale, and shows a superadmin warning banner with a
  one-click **Cancel** per stale sub (`cancelClientSubscription`, guarded to the
  client). Deliberately manual, never automatic (Owen's call). Verified live:
  the paid-tier flow attributes correctly (test client → Care sub, tier_key
  synced), and detection reports 0 stale when clean.

**Tier billing — remaining follow-ups:**

- **Tiers have no conversation cap.** `planForSubscription` falls back to 2,500
  for tier subs so the usage bar renders; give tiers a real cap if the chatbot
  volume differs by tier.
- **Duplicate Stripe customers.** Payment Links create a new customer per
  payment rather than reusing the client's existing one. The Phase 2 prompt
  cancels the stale SUB (stops the billing), but the orphaned customer remains.
  Fine for now; revisit if it clutters Stripe (reconcile-by-email in the webhook,
  or move to per-client Checkout Sessions).
- **Stripe Search is eventually consistent** (~seconds): a just-paid sub may take
  a moment to appear in the stale-sub check. Not a correctness issue — the banner
  just updates on the next load.
- **Local testing uses the Stripe CLI** (`stripe listen --forward-to
  localhost:3001/billing/webhook`) for webhook delivery; a deployed env needs a
  real webhook endpoint configured with the matching `STRIPE_WEBHOOK_SECRET`.

## Shipped 2026-07-24 (SEO audit consolidation + billing clarity)

- **Site Health now probes like a browser (fixes false "Down" alarms).** The
  old check fired ONE `fetch` + one TLS handshake against whatever address the
  OS returned. `hyperboledigital.com` has 4 apex A records — 2 Framer
  (work), 2 leftover GoDaddy domain-forwarding IPs on AWS Global Accelerator
  that fail the apex HTTPS handshake (they 301 on plain HTTP). So the naive
  check landed on a dead IP ~half the time and cried "Down" — while every real
  visitor was fine, because **browsers fail over across A records** and the
  apex-HTTP forward pushes to `www` (Framer) anyway. Correction to an earlier
  read of this: real visitor traffic is NOT materially broken; it was our
  checker being dumber than a browser. `lib/site-health.ts` now resolves every
  A/AAAA record, probes each, and reports Up if any serves the site + SSL from
  a working address — verified 6/6 consistent Up against the live site, and
  still correctly reports Down for dead/bad hosts. The GoDaddy forwarding IPs
  can't be deleted directly in DNS (GoDaddy-managed); leaving them is fine now
  that the checker handles them. Migration
  `supabase/migrate_2026-07-24_site-health-ssl-error.sql` (adds
  `site_health_checks.ssl_error`) — **already applied** (column confirmed
  present).
- **One persistent, validated website URL, shared everywhere.** `clients.domain`
  had no dashboard UI to edit at all (the earlier `localhost` bug this session
  could only be fixed via direct DB access) and nothing validated it — so a bad
  value silently broke Site Health, the SEO audit, and GSC defaults with no
  clear signal which one was the cause. Added `normalizeDomain`/`isPublicHost`
  to `packages/shared` (single definition, used by both apps — was previously
  duplicated only in `dataforseo.ts`) and wired validation into
  `upsertClient` itself (`lib/clients.ts`) so **every** save path is covered,
  not just the crawl one. Added a "Website URL" field to the client Config tab
  (superadmin-only, matches the Client name field's gating) with inline
  validation and copy explaining it's the one domain Site Health/SEO
  Audit/GSC all key off.
- **Site Health card now shows which domain it checked** and, when the SSL
  check itself fails (vs. the site genuinely not serving HTTPS), shows the
  real error instead of the misleading "Not served over HTTPS" — that message
  was collapsing "no TLS listener" and "TLS handshake errored" into the same
  text, which is exactly what happened with the DNS issue above.
- **Merged the two SEO "audit" tools into one.** The client SEO tab used to
  show a separate free PageSpeed Insights audit *and* the paid DataForSEO
  full-site crawl side by side under near-identical names — confusing, and
  the crawl regularly hung on "Crawling…" forever. PageSpeed audit (`lib/seo.ts`,
  `seo_audits` table) removed entirely; the client tab now runs the same
  DataForSEO crawl as the superadmin Audit Tool, rendered with the same
  `AuditReport` component. Report's SEO-score trend now sourced from crawl
  history (`getCrawlHistory`) instead of the deleted PageSpeed audits.
- **Crawl finalizer added server-side** (`finalizePendingCrawls`, polled every
  20s from `index.ts`) — a crawl used to only advance while a dashboard tab
  was open polling it (no scheduler on this platform), so closing the tab left
  it stuck `running` until the 10-min timeout. Now it finishes on its own.
  Also added a Cancel button + `POST .../cancel` route for a genuinely stuck
  crawl, and auto-resume-on-mount so reopening the tab picks the poll back up.
- **Root cause of "the client audit never works"**: DataForSEO can't crawl
  `localhost`/private hosts, and a misconfigured `clients.domain` was silently
  fed to it, spinning for 10 minutes before failing with no useful error.
  Added `isPublicHost()` guardrail in `lib/dataforseo.ts` — rejects
  loopback/private targets instantly with a clear message instead of timing
  out. (Root cause on the TEST client: `domain` was literally `"localhost"`.)
- **Request markdown now renders properly.** Change-request bodies (e.g. the
  auto-generated "SEO fix: titles & meta descriptions" drafts) are stored as
  markdown but were dumped into a single `<p>`, collapsing every newline into
  an unreadable wall of `###`/`**` text. Added a small dependency-free
  `Markdown` component (`components/markdown.tsx` — headings, bullets, bold/
  italic, bare-URL links, no `dangerouslySetInnerHTML`) used in
  `RequestDetailPanel`.
- **SEO settings clarity** — the client SEO tab's config fields (audit start
  URL, brand terms, GSC property) gave no indication which feature each one
  actually affects. Moved from a standalone section into a "Configure" button
  + modal in the audit card header, with each field now labeled with a
  feature tag (`SEO audit` / `AI visibility` / `Rankings`) and a one-line
  explanation, plus the client's real domain shown as the audit's default.
- **Billing tab: "Service tier" vs "Current plan" mismatch.** These are two
  unrelated systems (see the gap item above) that visually look like they
  should agree. Relabeled the tier card "Pricing-sheet tier (reference only —
  not billed)" with an explicit note that it isn't wired to Stripe, and added
  a superadmin-only warning banner on the Billing tab when the tier's price
  disagrees with the actual Stripe total.

## Shipped 2026-07-22 (MRR bug fixes)

Owen asked for plan changes to update MRR everywhere; while wiring that up,
`lib/overview.ts` turned out to have two real bugs affecting live revenue
numbers **today**, independent of tiers:

- **Add-on revenue was missing from MRR entirely.** Only `subscriptions.stripe_price_id`
  (the base plan) was summed — a client paying Pro $399 + SEO $499 + Content
  $799 showed as **$399**. Verified live against Spec-ID's real subscription:
  MRR was undercounting by **$1,298/mo**. Fixed via a new batched
  `getAddonRevenueByClient` (mirrors `entitlements.ts`'s per-client lookup).
- **Comped clients (`compClient` — friends & family, internal test clients)
  were counted as paying revenue.** A comp sets `status: 'active'` + a real
  `stripe_price_id` so entitlements resolve normally, but there's no card on
  file. Verified on a throwaway comped client: it contributed $399 to MRR
  before this fix, $0 after.
- `ClientRollup` (the Overview table) now carries the same `mrrCents` used in
  the aggregate — added an MRR column per client — and `getOverviewSummary`
  derives from `getClientRollups()` instead of re-querying separately, so the
  two can't drift apart.
- Client's own Billing tab now shows a combined "$X/mo total (plan + add-ons)"
  figure — previously the plan badge and each add-on's price sat in separate
  cards with no total anywhere.

**Deferred, Owen's call (2026-07-22):** tiers still aren't reflected in MRR —
a client can have both a tier assignment (e.g. Local SEO $1,200) and an
unrelated legacy Stripe plan, and today's MRR only counts the latter. Revisit
once real Stripe products exist for the tiers (see the pricing-tiers item
above) — summing both today would double-count, since they aren't the same
underlying subscription.

## Shipped 2026-07-21 (offer-sheet alignment)

- **Site Health card (Care tier)** — on-demand uptime + SSL check for every
  client regardless of add-ons (`lib/site-health.ts`, `site-health-card.tsx`,
  shown on client Home). HTTP fetch + a raw TLS handshake for cert expiry;
  badge goes amber under 30 days, red under 14. **Deliberately on-demand, not a
  poller** — no scheduler was added. Backups are intentionally NOT tracked:
  they live on Webflow/Framer (Owen's call). Migration:
  `migrate_2026-07-21_site-health.sql`.
- **Pricing tiers** (`lib/tiers.ts`, `migrate_2026-07-21_pricing-tiers.sql`) —
  all 6 sheet tiers hardcoded with real prices, plus `clients.vertical` /
  `clients.tier_key`. **No Stripe products yet, by choice** — assigning a tier
  is a field update, not a checkout. A tier is now a third entitlement source
  in `lib/entitlements.ts` (`source: 'tier'`) alongside Stripe add-ons and
  comps; a paid add-on correctly outranks a tier default. When the sheet is
  locked, this file is where price IDs get added — nothing else changes shape.
- **Local Presence** (`lib/local-presence.ts`, `LocalPresence.tsx`,
  `migrate_2026-07-21_local-presence.sql`) — the citation tracker (42 standard
  directories, one-click idempotent seed) with automatic NAP-drift detection
  against a canonical NAP on `portalConfig`, plus a Google Business Profile
  activity log with a "posts in the last 30 days" badge. **Both hand-maintained
  on purpose** — the GBP API needs Google-approved access, and citation
  submission is manual agency work anyway. NAP comparison is deliberately
  forgiving (St/Street, phone formatting) so real drift isn't buried in false
  positives; a drift flag overrides a hand-set "live" status. Gated behind a new
  `local` service key with a new `tier_only` status (no Stripe price, granted
  only by tier). Reads open to entitled clients, **writes superadmin-only**.

## Shipped this session (2026-07-15/16), not yet in the sections above

- **@mention notifications on change-request comments** — type `@` in a
  comment, pick a real person (Hyperbole team via `SUPERADMIN_USER_IDS`, or the
  client's own Clerk org members), they get a guarded email. Live-verified
  end-to-end. Comment authors now show their real Clerk name (was hardcoded
  "Hyperbole Digital" / "You" before — real bug, fixed).
- **Downloadable branded PDF audit report** — one-click, no print dialog
  (`lib/audit-pdf.ts`, jsPDF). Client-facing "Site Health Audit" card still
  only shows read-only results in-app — no PDF button there yet (only on the
  superadmin Audit Tool).
- **Frontend was swallowing real API error messages** (`lib/api.ts`
  `request()`) — every failure showed a bare "API error: {status}" instead of
  the server's actual message. Fixed; worth remembering if an old bug report
  said "just got error 400" with no other detail — the real cause was always
  in the API server logs, now it surfaces in the UI too.
- **Framer field mapping is a real, easy-to-miss setup step** — after "Load
  collection fields," the Title/Body/Slug/Meta dropdowns default to "— none —"
  and publish fails with "field mapping is incomplete" until someone maps
  Title + Body (Slug/Meta optional) to the client's actual Framer field names.
  Not automatable — depends on how each client named their CMS fields.

## Known rough edges (not bugs, just v1 scope cuts)

- Content editor is a plain textarea + custom markdown preview — no rich
  text editor.
- No CSV export anywhere (Overview, Reports).
- Reports have no historical trend chart — single-snapshot view only.
- Change requests have no attachment support (title + description only).

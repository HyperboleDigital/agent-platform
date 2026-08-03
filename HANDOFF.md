# Handoff — read this first in a new chat

Last updated: 2026-08-03, end of session. This doc exists so a fresh Claude
session (or a human) can pick up instantly. Delete/replace it once it's stale
— it's a snapshot, not permanent docs (that's `README.md`). See `TODO.md` for
the working punch list — Owen edits that directly, treat it as authoritative.

## THE APP IS NOW LIVE IN PRODUCTION (since 2026-08-02) — read this first

This is the single biggest state change since the last handoff. Before this
session, "production" didn't really exist — everything ran on `pnpm dev`
locally. Now:

- **API**: Render, Docker, `https://api.hyperboledigital.com`
  (`agent-platform-api-b90r.onrender.com` underneath). Auto-deploys on push
  to `main`.
- **Dashboard**: Vercel, `https://app.hyperboledigital.com`. Auto-deploys on
  push to `main`.
- **Widget**: Cloudflare Worker, `agent-widget.hyperboledigital.workers.dev/widget.js`,
  serving `apps/widget/src/widget.js` straight from GitHub `main` raw with a
  **5-minute cache**. One Worker serves every client — no per-client
  deploys, behavior comes entirely from `data-client-id`.
- DNS is at GoDaddy (`ns71/72.domaincontrol.com`) — CNAMEs for `api` and
  `app` point at Render's and Vercel's per-project targets respectively.

**Trap that cost real time this session and will bite again if repeated:**
this branch (`feat/dashboard-retrieval-escalation-mvp`) had gone weeks with
**zero commits** — the entire feature set was sitting as uncommitted
working-tree changes. Render/Vercel deploy from `main`, so production was
running a stale build with none of it. **Commit and push to `main` more
often now that a real deploy depends on it** — an uncommitted feature isn't
just "not merged," it's one bad `git checkout` away from gone, and it silently
won't exist for actual users.

**Env vars that MUST differ between local `.env` and Render's dashboard**
(Render env vars are set directly in its UI, not from a committed file):
`API_PUBLIC_URL`, `DASHBOARD_URL`, `ALLOWED_ORIGINS`, `GMAIL_REDIRECT_URI` all
need the real domains, not `localhost`. **Never set `PORT`** on Render — it
assigns its own and a hardcoded one fails the health check silently.

**Dockerfile gotcha, already fixed but worth knowing if it recurs:**
`ENV NODE_ENV=production` must come **after** `pnpm install` and
`pnpm --filter api build`, not before — pnpm honors `NODE_ENV=production`
during install by skipping `devDependencies`, which is where `typescript`
and `tsx` (a *runtime* dependency here, see the CMD comment in `Dockerfile`)
both live.

**Clerk is still on test keys** (`pk_test_`/`sk_test_`). Fine solo, but move
to a Clerk production instance before a real client logs in — shorter
sessions and dev-mode telemetry warnings otherwise. Not started.

## Most recent session (2026-08-02/03): widget config, domain lock, deploy, chat memory

Kicked off by testing the prospecting-generated chat widget on a real Framer
site and finding it broken — which surfaced the branch-never-committed
problem above. Ended up shipping the whole widget-config feature to
production plus two follow-on security fixes. In order:

- **Per-client widget branding**, stored in `clients.widget_config` (jsonb),
  served publicly (read-only, field-allowlisted) from
  `GET /widget-config/:clientId` — `apps/api/src/routes/widget-config.ts`.
  Title, colors, logo, teaser prompts, in-panel quick-reply chips. Dashboard
  editor: Chat Assistant tab → Widget section
  (`apps/dashboard/src/pages/client/Assistant.tsx`).
- **Logo upload** — `apps/api/src/lib/widget-logo.ts`, private Supabase
  storage bucket (`widget-logos`), served through our own origin (not a
  signed URL, which would expire while the widget's still embedded). Needed
  an explicit `Cross-Origin-Resource-Policy: cross-origin` override on that
  one route — Helmet's global same-origin default silently breaks `<img>`
  loads from any other origin, which is *every* real embed. No CORS error,
  no console error — just a broken image icon. Worth remembering if an
  uploaded asset ever "won't load" elsewhere.
- **Drag-to-reorder** for teaser prompts and quick-reply buttons —
  `apps/dashboard/src/components/reorderable-list.tsx`. Native HTML5 DnD, no
  library. Only the grip handle is draggable (not the row), so text
  selection inside the label/message inputs still works.
- **Domain lock** (the client explicitly did not trust an in-widget check,
  correctly — `widget.js` is public and trivially edited). Real enforcement
  is server-side: `WidgetConfig.allowedDomains` + `isOriginAllowed()` in
  `packages/shared/src/index.ts`, checked independently on `/chat`,
  `/contact`, and `/widget-config` — independently because a stolen script
  can hard-pin every setting via `data-*` attributes and skip the config
  fetch entirely, so `/chat` needs its own check to actually protect spend.
  Matches host + subdomains, rejects lookalike suffixes
  (`evil-spec-id.com` does NOT match an allowlisted `spec-id.com`). Empty/
  unset = open, so no existing client's behavior changed by adding the field.
  `widget.js` now distinguishes a definitive 403/404 (render nothing) from
  a timeout/outage (still render with defaults) — this distinction is the
  whole point, don't collapse it back to one fallback path.
- **Cost-cap fail-open bug, fixed.** `usage.ts`'s `countSince()` returned `0`
  on a query error, which reads as "no usage yet" — so a Supabase outage
  silently disabled every spend cap, including the platform-wide circuit
  breaker, exactly when it most needed to hold. Now returns `null` for
  unknown, and the two cap types deliberately behave differently: the
  **global breaker fails closed**, **per-client caps fail open** (a DB blip
  must not take a paying client's assistant offline on their own site).
- **Bounded chat memory**, `apps/api/src/lib/chat-memory.ts` — 8 turns /
  1000 chars per turn / 30-min TTL / 5000-session ceiling, threaded through
  both provider tool loops (`lib/llm/anthropic.ts`, `lib/llm/openai.ts`).
  Reconstructed server-side only, never accepted from the client (an
  attacker could otherwise forge assistant turns or pad history to inflate
  spend). **Deliberately not persisted to Postgres** —
  `message_logs` stores zero message text today, and writing visitor chat
  content to the DB is a privacy decision for a client to make on purpose,
  not a side effect of adding follow-up-question support. Matches the
  widget's own behavior, which already regenerates its session id and
  forgets its thread on every page reload.
- Two new migrations, both applied to the live DB:
  `migrate_2026-08-01_widget-config.sql`, `migrate_2026-08-01_widget-logo.sql`
  (creates the `widget-logos` bucket).
- Test client for all of this: **Spec-ID**
  (`3f2e6c15-7cfb-439b-9190-3c6a3a69ac12`) — currently has `allowedDomains`
  locked to `spec-id.framer.website`, so any curl/script test against it
  needs a matching `Origin` header or it'll correctly 403.
- **Noticed but not fixed:** Voyage AI embeddings are hitting 429s (no
  payment method on the Voyage account) — `knowledge-base.ts` already
  degrades gracefully to Postgres full-text search when this happens, so
  answers still work, just without semantic search. Fine for now, but add a
  payment method on the Voyage dashboard before this matters for quality.

## Previous session (2026-07-21): offer-sheet alignment

Owen supplied the **finalized Local Services + B2B offer sheets** and asked for a
gap report against the codebase, then had the top gaps built in order. Start here
before doing anything pricing- or tier-shaped:

- **`lib/tiers.ts` is the new source of truth for what we sell** — all 6 tiers,
  real prices. **Hardcoded, no Stripe products** (Owen's explicit call — the
  sheet may still change). Assigning a tier = a field update
  (`clients.vertical`/`tier_key`), not a checkout.
- **Every tier bullet carries a `built: boolean`.** The dashboard shows clients
  which promises are live versus still coming. **If you ship a sheet feature,
  flip its flag** — otherwise paying clients keep seeing it as unavailable.
  Only set `true` when the *whole* bullet is true.
- **Shipped:** Site Health (uptime + SSL, on-demand, every client), pricing
  tiers + tier-sourced entitlements, Local Presence (citation tracker with NAP
  drift detection + GBP activity log, both hand-maintained). Three new
  migrations, all applied to the live dev DB — see `TODO.md`.
- **Ads management is deliberately deferred** (Owen, 2026-07-21). It's a
  *billing-architecture* problem: the spend-tiered fee needs usage-based Stripe
  billing that doesn't exist, plus a Google/Meta API integration. Don't start it
  as if it were a dashboard ticket.
- **Trap to know about:** the sheets promise AI citation tracking across
  ChatGPT, Perplexity and Google AI Overviews. We only track **OpenAI +
  Anthropic**. Perplexity/Google-Extended appear in `lib/ai-search.ts` only as
  robots.txt bot names — crawler-blocking detection, *not* citation tracking.
  Don't mistake one for the other; the GEO bullets are `built: false` for
  exactly this reason.

## Current focus: SEO/GEO automation is LIVE (started 2026-07-15)

The active initiative is **automating the SEO/GEO service** and, second, an
**automated website-rebuild engine** on Framer. The SEO side moved from plan to
a working, live-verified product in one session — **read the plan doc's
checkpoint log before doing SEO work, it's the real source of truth**:

- **`docs/plans/seo-automation.md`** — DONE through: DataForSEO crawl → /100
  site-health score → AI-Search-Health/GEO score (bot blocking, llms.txt,
  sitemap.xml) → severity-ranked issues with affected URLs → one-click AI
  fixes (titles/meta, schema, llms.txt) as change requests → downloadable
  branded PDF → rolled into monthly client Reports. Superadmin-only Audit Tool
  crawls any URL on demand. **Everything is manual-trigger by deliberate
  choice — no scheduler exists and none should be added without Owen asking.**
  A SEMrush side-by-side comparison validated our numbers and directly
  informed the AI-Search-Health build (see checkpoint log for specifics).
- **`docs/plans/website-rebuild.md`** — approved, feasibility spike
  desk-research done (Framer 3.0 Server/Canvas/Plugin APIs + MCP look viable).
  Hands-on spike (build real pages on a throwaway Framer project) still
  pending — needs a throwaway project + credentials from Owen. Built **after**
  SEO work (shares the crawler); not started.

Also shipped this session, off the SEO plan: **@mention notifications on
change-request comments** (real Clerk names, guarded per-person email,
live-verified) and a fix for a real bug where comment authors always showed
the hardcoded "Hyperbole Digital"/"You" instead of their actual name.

**Checkpoint convention (so progress is never lost across chats):** each plan
doc has a `## Checkpoint log` at the bottom. Append a dated entry whenever you
make meaningful progress or change a decision — and always before ending a
session or when context runs low. The plan docs are the durable source of truth;
this Handoff just points at them.

## State (2026-08-03)

Everything through commit `31e37cb` is committed and pushed to `main`
directly (this branch has been pushing straight to `main` rather than via PR
for deploy-critical fixes — see the production section above for why). Working
tree is clean. `git log origin/main --oneline -1` should match local `HEAD` —
if it doesn't, something didn't get pushed; check before starting new work.

All migrations through `migrate_2026-08-01_widget-logo.sql` are applied to the
live Supabase DB, including the widget-config and widget-logo ones from this
session. `supabase/schema.sql` reflects the current full schema for fresh
installs.

## Where things stand — by phase

**Phase 1 — Security foundation: DONE.** Clerk auth, tenant isolation,
RLS, abuse/rate caps, Gmail token encryption, file-upload validation.

**Phase 2 — Stripe billing (base plans): DONE.** Checkout, Customer
Portal, webhook sync, plan-based conversation caps, superadmin comp.

**Phase 3 — Dashboard redesign: DONE.** Tailwind + shadcn/ui, dark-first,
accent `#BA9E66`, Work Sans. App shell, client list, superadmin Overview
(MRR/usage rollups).

**Phase 4 — Client portal (slices 1–6): ALL DONE.** This was the bulk of
this session. The dashboard is now a modular service marketplace — a
client has a base plan (Starter/Pro) plus toggleable add-on services
(SEO, Content), with unpurchased sections rendering as a locked
upgrade-CTA in the sidebar rather than being hidden. Slice-by-slice:

1. **Entitlements + add-on billing** — `lib/services.ts` (SERVICES
   catalog, keyed by Stripe price ID, `available` | `coming_soon`
   status), `lib/entitlements.ts` (resolves base-plan-or-comp ∪ add-on
   items into per-service entitlement), `lib/billing.ts` extended with
   `addServiceToSubscription`/`removeServiceFromSubscription` (real
   Stripe `subscriptionItems`, `always_invoice` proration) and per-service
   comps. Dashboard: `LockedSection` gate component, Services list on
   Billing tab.
2. **Dashboard IA restructure** — per-client tabs became sidebar nav
   under nested `/clients/:id/*` routes (`ClientLayout` + outlet
   context). Gated sections show a lock icon until entitled.
3. **SEO + AI visibility** (the `seo` service) — `lib/gsc.ts` (Google
   Search Console, one shared service-account credential, daily
   snapshot cache — **not yet connected, see TODO.md**), `lib/seo.ts`
   (PageSpeed Insights audits, **live-verified with a real
   `PAGESPEED_API_KEY`** against hyperboledigital.com), `lib/visibility.ts`
   (real ChatGPT/Claude web-search calls judging brand mentions — OpenAI
   leg confirmed working live; Anthropic leg degrades gracefully due to
   low account credits, see TODO.md). Dashboard: `Seo.tsx`, `Visibility.tsx`.
4. **Change requests + notifications** — `lib/change-requests.ts`,
   `lib/notify.ts` (central event router; Slack + email, both to a
   client's own configured channels AND the superadmin's). **Email
   guardrails are load-bearing, not decorative** — see next section.
   Dashboard: `Requests.tsx`, notification settings card on Config,
   cross-client queue on Overview. Live-verified: real Slack post + real
   email both confirmed delivered from one controlled test.
5. **Content engine** (the `content` service) — `lib/content.ts` is the
   quality-critical piece: a writer prompt with testable rules (keyword
   placement mechanics, mandatory self-contained FAQ for AI-search
   citation, anti-slop ban list + positive specificity test), structured
   JSON output with mechanical validation + one targeted repair pass,
   and an enforced review lifecycle (draft → in_review → approved →
   published → archived). `lib/framer.ts` publishes to the client's
   Framer CMS via the official `framer-api` package. **Live-verified
   end-to-end against Owen's real Hyperbole Digital Framer project**:
   generate → approve → publish created a real CMS item, confirmed
   present, then deleted (his two real blog posts untouched throughout).
   Dashboard: `Content.tsx`, `FramerConnectionCard`.
6. **Reports + manual email** — `lib/reports.ts` aggregates existing
   data (chat stats, SEO score delta, visibility mention rate, closed
   requests) into a persisted snapshot; sending is a superadmin-only,
   explicit-recipient action routed through the same guardrailed email
   path as slice 4. Live-verified: a real report generated from real
   historical data, sent to a *deliberately wrong* address to confirm
   the test-mode guardrail actually redirects it (confirmed:
   `{"sent":true,"recipient":"hello@hyperboledigital.com","testMode":true}`).

## The email guardrail (read this before touching anything email-related)

This codebase had a **582-email incident** in its history (an unbounded
loop auto-sent that many emails to a real inbox). Every platform-sent
email since goes through `sendGuardedEmail` in `lib/notify.ts`:

- Sent from a **platform** Gmail connection (`PLATFORM_SENDER_CLIENT_ID`
  → currently Spec-ID's connection, a stand-in — see TODO.md), never a
  client's own inbox.
- `REPORT_EMAIL_TEST_MODE` (default effectively on) redirects **every**
  recipient to `REPORT_TEST_INBOX` regardless of what's configured
  elsewhere — this is deliberate defense-in-depth, not a bug.
- A **persisted** daily cap (`NOTIFY_EMAIL_DAILY_CAP`) backed by a
  `notification_log` table, not an in-memory counter — survives restarts.
- **Nothing scheduler-shaped may ever import this path.** There is no
  scheduler yet (see TODO.md) — if one gets built, report/notification
  email must stay excluded by construction, not by convention.

## Two real infra bugs found this session (worth knowing about)

- **`framer-api` needs a global `WebSocket`** — it does a hard-coded
  `new WebSocket(...)` with no injectable transport (unlike
  `@supabase/supabase-js`'s `realtime.transport` option in
  `lib/supabase.ts`). Polyfilled via dynamic `import('ws')`, scoped only
  to `lib/framer.ts`'s `getConnect()`.
- **`framer-api` ships ESM with top-level await** — `tsx watch`'s CJS
  transform pipeline can't statically import it in this CommonJS
  project. Loaded via dynamic `import('framer-api')` instead (goes
  through Node's native ESM loader). Note: ad-hoc `pnpm exec tsx
  some-script.mts` one-off scripts can still hit a resolution quirk with
  this dynamic import that the real running server (`tsx watch
  src/index.ts`) doesn't — if a standalone verification script fails
  with `ERR_UNSUPPORTED_RESOLVE_REQUEST` on `framer-api`, that's the
  script, not the app; verify through the real dashboard/API instead.
- **Framer collection/field IDs are not stable** — editing a CMS
  collection's structure in the Framer editor can change its ID (this
  actually happened mid-session on Hyperbole Digital's own "Blog"
  collection). A stored `framer_connections` mapping can go stale;
  superadmin re-maps via "Load collection fields" when that happens.
- **PostgREST upsert can't omit a NOT NULL column, even on conflict** —
  `saveFramerConnection`'s original "leave the API key unchanged on
  update" logic omitted `api_key_enc` from the payload, which failed
  with a not-null violation because Postgres validates the upsert's
  INSERT-branch row before the ON CONFLICT check applies. Fixed by
  re-fetching and re-supplying the existing encrypted value explicitly.
  Worth remembering for any future "partial update via upsert" code.

## Dev environment

- `pnpm dev` from repo root, or per-app: `cd apps/api && pnpm dev`
  (:3001), `cd apps/dashboard && pnpm dev` (:5173).
- Migration state: see "State (2026-08-03)" above — it's the current marker,
  this bullet isn't duplicated to avoid the two drifting apart again.
- Test client: **Spec-ID**, id `3f2e6c15-7cfb-439b-9190-3c6a3a69ac12` —
  comped to Pro base plan. Add-on services (seo/content) are NOT comped
  by default — comp them via the Billing tab or `grantService()` when
  testing those areas, and remember to revoke after. Its `widgetConfig` is
  currently domain-locked to `spec-id.framer.website` (see this session's
  notes above) — a local `/chat` test needs a matching `Origin` header.
- If dev servers act stale: `pkill -9 -f "agent-platform/apps/api"` and
  `pkill -9 -f "agent-platform/apps/dashboard"`, confirm `lsof -i :3001` /
  `:5173` are empty, then restart both fresh.

## Testing notes for a fresh session

To drive an authenticated browser session with Playwright (no interactive
login): mint a Clerk sign-in ticket server-side via
`clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds })`
(needs `@clerk/express`, run from `apps/api`), then navigate to
`http://localhost:5173/sign-in?__clerk_ticket=<token>`. Keep dwell time
short (well under 15-20s) or re-mint.

For any standalone verification script that touches `@supabase/supabase-js`
directly (not through the app's `lib/supabase.ts`, which already handles
this) or `framer-api`, you'll likely need:
```ts
import { WebSocket } from 'ws'
;(globalThis as any).WebSocket = WebSocket
```
before importing either — Node 20 has no native global `WebSocket`.

**Always clean up test data after live verification** — this session
consistently comped services, generated content, published/deleted a
real Framer CMS item, and sent real emails/Slack messages, then reverted
everything (revoked comps, deleted test rows, restored Spec-ID's
baseline). Follow the same discipline: whatever you touch to verify,
revert when done.

## Key files to read before continuing

- `docs/plans/seo-automation.md` + `docs/plans/website-rebuild.md` — the two
  active initiatives (see "Current focus" above); read these first for new work
- `TODO.md` — the actual next-steps list, Owen-maintained
- `apps/dashboard/DESIGN_SYSTEM.md` — design system spec
- `README.md` — normal project docs (stack, onboarding, integrations)
- `/Users/owenferreira/.claude/plans/noble-squishing-parrot.md` — the
  original Phase 4 6-slice plan this session executed in full

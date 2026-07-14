# Handoff — read this first in a new chat

Last updated: 2026-07-14, end of session. This doc exists so a fresh Claude
session (or a human) can pick up instantly. Delete/replace it once it's stale
— it's a snapshot, not permanent docs (that's `README.md`). See `TODO.md` for
the working punch list — Owen edits that directly, treat it as authoritative.

## State: everything committed, nothing pending

Unlike prior handoffs, there is **no uncommitted work**. `git status --short`
is clean. Every phase below is committed on `feat/dashboard-retrieval-escalation-mvp`.

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
- All migrations through `migrate_2026-07-14_reports.sql` are applied to
  the live Supabase DB. `supabase/schema.sql` reflects the current full
  schema for fresh installs.
- Test client: **Spec-ID**, id `3f2e6c15-7cfb-439b-9190-3c6a3a69ac12` —
  comped to Pro base plan. Add-on services (seo/content) are NOT comped
  by default — comp them via the Billing tab or `grantService()` when
  testing those areas, and remember to revoke after.
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

- `TODO.md` — the actual next-steps list, Owen-maintained
- `apps/dashboard/DESIGN_SYSTEM.md` — design system spec
- `README.md` — normal project docs (stack, onboarding, integrations)
- `/Users/owenferreira/.claude/plans/noble-squishing-parrot.md` — the
  original Phase 4 6-slice plan this session executed in full

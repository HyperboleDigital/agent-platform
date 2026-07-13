# Handoff — read this first in a new chat

Last updated: 2026-07-13, end of session. This doc exists so a fresh Claude
session (or a human) can pick up instantly. Delete/replace it once it's stale
— it's a snapshot, not permanent docs (that's `README.md`).

## ⚠️ Do this first: NOTHING is committed

Branch `feat/dashboard-retrieval-escalation-mvp` (off `main`) is way ahead of
its last commit (`66a6f35`). Everything below — all of Phase 2 billing and
all of Phase 3 dashboard redesign — is sitting **uncommitted** in the working
tree. `git status --short` to see the full diff. **First thing a new session
should do: review and commit this**, before touching anything else, or ask
the user if they want it committed as one or several commits.

## Where things stand — by phase

**Phase 1 — Security foundation: DONE, committed, live-verified.**
Clerk auth, tenant isolation (Clerk Orgs), RLS, abuse/rate caps, Gmail token
encryption, CRLF-injection fix, file-upload magic-byte validation. Nothing
left here.

**Phase 2 — Stripe billing: DONE, uncommitted.**
Checkout, Customer Portal, webhook sync, plan-based conversation caps
(Starter $199/mo/500 convos, Pro $399/mo/2500 convos), superadmin "comp"
endpoint. Live-tested with a real Stripe test-mode subscription (checkout →
webhook → active → cancel → blocked again, all confirmed). Key files:
`apps/api/src/lib/billing.ts`, `apps/api/src/routes/billing.ts`,
`supabase/migrate_2026-07-12_billing.sql` (**already run** on the live
Supabase DB — schema is caught up even though the code isn't committed).

**Phase 3 — Dashboard redesign: IN PROGRESS, uncommitted.**
Design system: Tailwind + shadcn/ui, dark-first, accent `#BA9E66`, font Work
Sans. Full spec in `apps/dashboard/DESIGN_SYSTEM.md` — read that before
touching any UI code. Done so far:
- Token layer, app shell (sidebar + topbar + role-aware nav), theme toggle
- Both existing pages fully converted (client list, client detail + all 5
  tabs: Knowledge, Leads, Connectors, Billing, Config)
- Billing success/cancel toast (was a known gap, now fixed)
- Conversations trend chart + usage-vs-plan-cap bar (recharts, themed)
- **API-down handling**: a dedicated "Can't reach the server" screen in the
  app shell (polls `/health` every 15s) — deliberately NOT a redirect to
  sign-in, since Clerk auth stays up independent of our API. Live-verified
  both directions (kill API → screen appears in ~2s; restart → recovers).

**Not started yet:**
- Superadmin platform-wide Overview (revenue/usage rollups across all
  clients) — needs new aggregate API endpoints, biggest remaining lift.
- `/design-sync` — user wants to sync the shadcn component library to a
  claude.ai/design project. Was interrupted before starting (user asked
  "is the api running" instead). To resume: user should type `/design-sync`
  themselves (that skill has `disable-model-invocation` — I can't trigger it
  programmatically, only via `ToolSearch(query: "select:DesignSync")` +
  following the skill's own instructions once they invoke it).

## Real bugs found & fixed this session (worth knowing about)

- Stripe subscription `.upsert()` was missing `onConflict: 'client_id'` —
  caused silent duplicate-key failures on every real webhook sync. Fixed in
  `lib/billing.ts`.
- Pricing said "500 conversations/**month**" but enforcement checked a
  **daily** bucket — a Starter client could've been blocked after 500
  messages in one day. Fixed in `lib/usage.ts` (now separate daily
  abuse-ceiling vs. monthly plan-cap checks).
- Dozens of zombie `tsx watch`/`vite` dev processes had accumulated across
  the session (some from days earlier), and a stale one was silently
  serving old code on port 3001. If dev servers act like they're not
  picking up changes: `pkill -9 -f "agent-platform/apps/api"` and
  `pkill -9 -f "agent-platform/apps/dashboard"`, confirm `lsof -i :3001` /
  `:5173` are empty, then restart both fresh. Don't just `lsof -ti:PORT |
  xargs kill` — that can miss the actual listening PID if there are
  multiple stacked processes.

## Dev environment

- `pnpm dev` from repo root, or per-app: `cd apps/api && pnpm dev` (:3001),
  `cd apps/dashboard && pnpm dev` (:5173).
- `apps/api/.env` and `apps/dashboard/.env.local` are filled in and
  gitignored — real keys for Clerk, Stripe (test mode), Supabase, Anthropic,
  OpenAI, Voyage, Gmail. `LLM_PROVIDER=openai` currently (Anthropic credits
  were drained earlier in the project's history — flip back to `anthropic`
  once topped up).
- Superadmin: `SUPERADMIN_USER_IDS` in `apps/api/.env` has the user's Clerk
  ID already.
- Test client: **Spec-ID**, id `3f2e6c15-7cfb-439b-9190-3c6a3a69ac12` — has
  real knowledge base docs, leads, and (as of last check) is comped to Pro
  via the superadmin comp endpoint (not a real Stripe subscription).

## Testing notes for a fresh session

To drive an authenticated browser session with Playwright (no interactive
login needed): mint a Clerk sign-in ticket server-side via
`clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds })`
(needs `@clerk/express`, run from `apps/api` where `CLERK_SECRET_KEY` is
available), then navigate to
`http://localhost:5173/sign-in?__clerk_ticket=<token>`. **Keep dwell time on
that ticket-derived session short (well under 15-20s)** — it degrades and
silently redirects back to sign-in if the page sits open too long. For
anything requiring longer interaction, re-mint a fresh ticket rather than
reusing an old page session.

Also: never background-restart a dev server via Node's `execSync('... &
disown')` from inside a Playwright script — it hangs waiting on the piped
fd even when redirected. Use a separate Bash tool call instead.

## Model usage note

Per the original plan: Fable 5 (or Opus) for security-boundary/money-path
design decisions and design-system/taste calls; Sonnet for mechanical
build-out once a design is set. This session did Phase 1 core auth design
on Fable, Phase 3's design-system spec on Fable, everything else on Sonnet.

## Key files to read before continuing

- `apps/dashboard/DESIGN_SYSTEM.md` — the design system spec (tokens,
  components, IA, build order)
- `/Users/owenferreira/.claude/plans/okay-it-s-time-for-transient-sutherland.md`
  — the original 4-phase roadmap this session has been executing
- `README.md` — normal project docs (stack, onboarding, integrations status)

# Agent Platform

Multi-tenant AI agent platform — FAQ, booking, lead capture, escalation. Serves an
embeddable chat widget grounded in each client's own knowledge base. When the
chatbot can't help or a visitor asks for a person, it escalates to a human via
Slack and a clearly-marked email.

> **Scope note:** The chatbot answers on the client's website. Reading and
> auto-answering a client's email *inbox* is intentionally out of scope for now —
> the only outbound email the platform sends is an escalation notice to a human.

## Stack
- **API** — Node.js + Express + Claude API (Railway)
- **Dashboard** — React + Vite (Vercel)
- **DB** — Supabase (Postgres + pgvector)
- **AI** — Anthropic Claude Sonnet + Voyage AI embeddings

## Quick start

```bash
# Install
pnpm install

# Set up env vars
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
# Fill in your keys

# Run the DB schema: paste supabase/schema.sql into your Supabase SQL editor

# Start dev servers
pnpm dev
```

API runs on http://localhost:3001
Dashboard runs on http://localhost:5173

## Project structure

```
agent-platform/
├── apps/
│   ├── api/                  # Node.js backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── orchestrator.ts   # Claude brain — edit prompts here
│   │       │   ├── clients.ts        # Client CRUD
│   │       │   ├── logs.ts           # Message logging + dashboard stats
│   │       │   ├── embeddings.ts     # Voyage embeddings + chunking
│   │       │   ├── gmail.ts          # Gmail OAuth (send-only) — escalation emails
│   │       │   ├── escalation.ts     # "Get a human" → DB + Slack + email
│   │       │   └── supabase.ts       # DB client
│   │       ├── tools/
│   │       │   ├── knowledge-base.ts # Hybrid vector + full-text search
│   │       │   ├── calendly.ts       # Booking (link only — see Integrations)
│   │       │   ├── crm.ts            # Lead logging
│   │       │   └── slack.ts          # Escalation alerts
│   │       ├── scripts/
│   │       │   └── backfill-embeddings.ts
│   │       └── routes/
│   │           ├── chat.ts           # Widget chat endpoint (public)
│   │           ├── contact.ts        # Widget contact form → human (public)
│   │           ├── auth.ts           # Gmail OAuth connect flow
│   │           ├── clients.ts        # Dashboard API (auth)
│   │           └── webhooks.ts       # External triggers (auth, stub)
│   ├── dashboard/            # React admin UI
│   ├── widget/               # Embeddable chat JS + Cloudflare worker
│   └── tools/                # Python website scraper (standalone)
├── packages/
│   └── shared/               # Shared TypeScript types
└── supabase/
    └── schema.sql            # Run this first
```

## Auth

Dashboard users sign in with Clerk. Admin routes (`/clients`, `/webhooks`) require
a valid Clerk session — the dashboard attaches the session token automatically
(see `apps/dashboard/src/AuthBridge.tsx`); a raw request needs
`Authorization: Bearer <clerk-session-jwt>`.

**Tenant model:** each client maps to one Clerk Organization (`clients.clerk_org_id`).
A signed-in user can only read/write the client whose `clerk_org_id` matches their
active org. Your team gets cross-tenant access via `SUPERADMIN_USER_IDS` (comma-separated
Clerk user IDs) in `apps/api/.env` — set your own Clerk user ID there after your first
sign-in (find it in the Clerk dashboard under Users).

The widget's `/chat` and `/contact` endpoints are public (rate-limited) — no login,
since they're called anonymously by website visitors.

## Onboarding a new client

1. **Create the client row** — `POST /clients` with `{ name, domain, industry, agentConfig }`,
   or add it in the dashboard. Note the returned `id` (UUID).
2. **Ingest knowledge** — run the scraper against the client's site:
   ```bash
   cd apps/tools
   python website-scraper.py --url https://theirsite.com --client-id <uuid>
   ```
   (Set `VOYAGE_API_KEY` in `apps/api/.env` to store embeddings; otherwise search
   falls back to full-text.) You can also add docs from the dashboard Knowledge tab.
3. **Embed the widget** on their site:
   ```html
   <script src="https://your-worker.dev/widget.js"
     data-client-id="<uuid>"
     data-api-url="https://your-api.railway.app"
     data-color="#6C5CE7"
     data-title="Support"></script>
   ```
4. **Set an escalation address** — in the dashboard Config tab, set `escalationEmail`
   (and/or a Slack webhook). When the chatbot escalates or a visitor uses the contact
   form, a human is notified there.
5. **(Optional) Connect Gmail for escalation emails** — visit `/auth/gmail?clientId=<uuid>`
   to authorize a send-only Gmail account. Escalation emails are sent from it, marked
   with a `[Website Chat]` subject prefix so the recipient can auto-file them with a
   one-time Gmail filter. Without this, escalations still go to Slack.

## Retrieval

Knowledge search is hybrid: if `VOYAGE_API_KEY` is set, it embeds the query and runs
vector similarity via the `match_knowledge` RPC, falling back to Postgres full-text /
`ilike`. Documents are chunked (~500 tokens) at ingestion. Backfill embeddings for
existing rows with `pnpm --filter api backfill`.

## Adding a new agent capability

1. Add a tool definition in `apps/api/src/lib/orchestrator.ts`
2. Implement the handler in `apps/api/src/tools/your-tool.ts`
3. Import and wire it into the orchestrator tool loop

## Integrations status

- **Escalation → human** — full: chatbot escalations + contact-form submissions are
  recorded and sent to a human via Slack and a `[Website Chat]`-tagged email (send-only
  Gmail). Reading/answering a client's inbox is out of scope by design.
- **Slack** — full: escalation alerts via incoming webhook.
- **Knowledge base** — full: scraper + hybrid search.
- **Calendly** — link-only (builds a prefilled scheduling URL; not the Calendly API).
- **Webhooks** (`routes/webhooks.ts`) — stub: logs and acks. Add handlers per integration.
- **Google Search Console** — code complete (`lib/gsc.ts`), gated behind
  `GSC_SERVICE_ACCOUNT_JSON` — not yet configured in any environment. Needs a
  Google Cloud service account added as a restricted user on each client's
  GSC property. See `TODO.md`.
- **PageSpeed Insights** — full, `PAGESPEED_API_KEY` set and live-verified.
- **AI-search visibility** (ChatGPT/Claude) — full for OpenAI; Anthropic leg
  degrades gracefully due to account credit balance (see `TODO.md`).
- **Framer publishing** — full, official `framer-api` Server API,
  live-verified end-to-end. Each client needs their own connection configured
  (project URL, API key, collection ID, field mapping) before their Content
  service can publish.
- **Stripe billing** — full: base plans (Starter/Pro) + add-on services
  (SEO, Content) via `subscriptionItems`, webhook-synced.

## Client portal services (Phase 4)

On top of the chatbot, the dashboard is a modular add-on marketplace — see
`apps/api/src/lib/services.ts` for the catalog. A client's base plan grants
the chatbot; add-on services unlock further dashboard sections (shown locked
with an upgrade CTA until purchased or comped):

- **SEO** (`seo`) — PageSpeed audits + AI-visibility tracking +
  (once configured) Google Search Console rankings.
- **Content** (`content`) — AI-drafted, keyword-targeted blog posts with a
  review lifecycle (draft → in_review → approved → published), publishing to
  the client's Framer CMS.
- **Change requests** — free with any active base plan (not gated). Clients
  submit; a superadmin triages via status transitions, notified over
  Slack/email.
- **Reports** — performance snapshots aggregating the above, with a
  superadmin-triggered guarded email send (see the email guardrail note in
  `HANDOFF.md` if you're touching anything email-related).
- **Superadmin Overview** (`/overview`) — platform-wide MRR/usage rollups and
  a cross-client change-request queue.

Not yet built: a scheduler for automated (vs. on-demand) audits/checks, and
paid SERP-based rank tracking. See `TODO.md`.

## Deploying

- **API** → Railway: connect repo, set env vars, deploy `apps/api`
- **Dashboard** → Vercel: connect repo, set env vars, deploy `apps/dashboard`
- **Widget** → Cloudflare Worker (`apps/widget/cloudflare-worker.js`, set `WIDGET_SOURCE_URL`)
  or any CDN; embed the script tag on client sites

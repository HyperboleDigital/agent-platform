# Agent Platform

Multi-tenant AI agent platform — FAQ, booking, lead capture, escalation.

## Stack
- **API** — Node.js + Express + Claude API (Railway)
- **Dashboard** — React + Vite (Vercel)
- **DB** — Supabase (Postgres + pgvector)
- **AI** — Anthropic Claude Sonnet

## Quick start

```bash
# Install
pnpm install

# Set up env vars
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
# Fill in your keys

# Run Supabase schema
# Paste supabase/schema.sql into your Supabase SQL editor

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
│   │       │   └── supabase.ts       # DB client
│   │       ├── tools/
│   │       │   ├── knowledge-base.ts # Doc search
│   │       │   ├── calendly.ts       # Booking
│   │       │   ├── crm.ts            # Lead logging
│   │       │   └── slack.ts          # Escalation alerts
│   │       └── routes/
│   │           ├── chat.ts           # Widget endpoint
│   │           ├── email.ts          # Gmail webhook
│   │           ├── clients.ts        # Dashboard API
│   │           └── webhooks.ts       # n8n / external
│   ├── dashboard/            # React admin UI
│   └── widget/               # Embeddable chat JS
├── packages/
│   └── shared/               # Shared TypeScript types
└── supabase/
    └── schema.sql            # Run this first
```

## Adding a new agent capability

1. Add a new tool definition in `apps/api/src/lib/orchestrator.ts`
2. Implement the handler in `apps/api/src/tools/your-tool.ts`
3. Import and wire it in the orchestrator tool loop

## Adding a new integration (webhook)

Add a route in `apps/api/src/routes/webhooks.ts` — no other files need to change.

## Deploying

- **API** → Railway: connect repo, set env vars, deploy `apps/api`
- **Dashboard** → Vercel: connect repo, set env vars, deploy `apps/dashboard`
- **Widget** → Vercel or CDN: deploy `apps/widget`, embed script tag on client sites

# CLAUDE.md — agent-platform

Multi-tenant AI agent platform (chat widget + client dashboard). See README.md
for stack and structure, TODO.md for current work.

## ⚠️ PRODUCTION — live paying clients

**Two paying clients are live on this platform and use the dashboard.**
`main` is production: pushes to `main` deploy to the live API (Railway) and
dashboard (Vercel). Treat every change to `main` as a change clients will see.

## Git workflow (non-negotiable)

1. **Never commit directly to `main`. Never push or merge to `main` without
   Owen's explicit approval.**
2. All work happens on a feature branch (`feat/...`, `fix/...`). If we're on
   `main` when work starts, create/switch to a branch first.
3. Owen tests changes **locally** on that branch (`pnpm dev` — API on :3001,
   dashboard on :5173) before anything ships.
4. Only when Owen explicitly says something like **"push this branch to main"**
   do you merge/push to `main`. Approval of one branch does not carry over to
   the next change — each merge needs its own go-ahead.
5. After merging, confirm what was deployed and watch for anything client-facing.

## Other guardrails

- **Email:** never auto-send email to a real inbox. Escalation email is the only
  outbound email; scheduled reports are draft + Slack-nudge only (sending is a
  superadmin click; test mode redirects to hello@).
- **Database:** schema changes go through migration files, never ad-hoc edits to
  the live Supabase DB. Anything touching client data gets flagged before running.
- **Verify before claiming done:** run the code / hit the endpoint, don't assume.

## Dev commands

```bash
pnpm install
pnpm dev        # API :3001 + dashboard :5173
pnpm build
```

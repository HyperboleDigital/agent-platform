# TODO

Working list of what's next / unfinished. Owen reviews and edits this
directly — treat entries here as authoritative over anything a session
summary elsewhere implies.

## Deferred from the Phase 4 plan (not started)

- **Scheduler** — everything built in Phase 4 (SEO audits, PageSpeed
  checks, AI-visibility checks) is on-demand only ("Run now" buttons).
  No cron/scheduled job exists anywhere in the API. Fast-follow: a
  `node-cron`-based `lib/scheduler.ts`, gated behind `ENABLE_SCHEDULER=true`
  so it's opt-in, running weekly audits + visibility checks per entitled
  client, staggered. **Report/notification email must stay excluded from
  anything scheduler-reachable** — that's a deliberate guardrail from the
  582-email incident, not an oversight.
- **Google rank tracking via paid SERP API** (DataForSEO or Serper) —
  intentionally skipped for v1 in favor of free Google Search Console
  data. Revisit only if GSC's data turns out insufficient once it's
  actually connected (see below).

## Needs real-world setup before it does anything

- **Google Search Console connection** — `lib/gsc.ts` is fully built and
  gated behind `GSC_SERVICE_ACCOUNT_JSON`, which is **not set** in any
  environment yet. Needs: create a Google Cloud service account, enable
  the Search Console API, add that service account as a restricted user
  on each client's GSC property, then set the JSON credential. Until
  then, the SEO page's "Rankings" section will always show "Search
  Console not connected."
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
  `PLATFORM_SENDER_CLIENT_ID` currently points at Spec-ID's Gmail
  connection as a stand-in sender — swap to a real Hyperbole Digital
  client record once one exists, so platform emails don't appear to come
  from a test client.

## Known rough edges (not bugs, just v1 scope cuts)

- Content editor is a plain textarea + custom markdown preview — no rich
  text editor.
- No CSV export anywhere (Overview, Reports).
- Reports have no historical trend chart — single-snapshot view only.
- Change requests have no attachment support (title + description only).

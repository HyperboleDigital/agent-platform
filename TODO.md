# TODO

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

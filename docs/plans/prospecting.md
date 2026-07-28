# Plan: Cold-Outreach Prospecting Engine

**Status:** scoped, NOT started. Deferred until onboarding + chatbot testing is done.
**Owner:** Owen. **Scoped:** 2026-07-26.

> Living document. Append to the Checkpoint log when anything changes.

## Goal

Give admin (Hyperbole) a tool to find local businesses that would benefit from
our services, collect their contact info, and run **templated, bulk-but-
confirmed** cold outreach with a simple follow-up flow — starting in the Tampa
area, with med spas as one high-value vertical (but not the only one).

Owen's explicit requirements:
- Intelligently find local businesses — especially ones **without a website**
  (prime "we'll build you one" targets), and higher-value verticals.
- Work in **bulk**, with "levels to the game."
- **Templated** outreach, sendable in bulk, but **confirm everything before
  sending** — never blast random emails.
- **Follow-up flow**: a status like "reached out" → after ~24–48h, it's due for
  a **one-click** follow-up. NOT fully automatic — Owen stays in control.
- Collect **emails and phone numbers** of local small-business owners.

## The hard part: where does the data come from?

This is the crux and determines everything. Reality check on each field:

- **Finding businesses by area + type** — ✅ easy. Google **Places API** (already
  wired, `PLACES_API_KEY`) does Text Search / Nearby Search by category +
  location. Filter by category (med spa, dental, law, HVAC, etc.), rating, and
  review count as a proxy for "established / has money."
- **Does it have a website?** — ✅ doable. Place Details returns `websiteUri`;
  **absent = no website = prime target.** Exactly the filter Owen wants.
- **Phone number** — ✅ Places returns it (`internationalPhoneNumber`).
- **Email** — ❌ the gap. Google does NOT expose owner emails. Options:
  1. If they have a website, scrape it for a contact email (works sometimes).
  2. A B2B enrichment vendor (Hunter.io, Apollo, Clearbit) — paid, per-lookup.
  3. Manual: the tool surfaces the business + phone + site, Owen finds the email.
  Since the best targets have NO website, on-site scraping won't help them —
  so email for the juiciest leads is genuinely hard. **Likely start phone-first
  / manual-email, add an enrichment vendor later.**

**Compliance / ToS (must not skip):**
- Scraping Google Business Profile pages directly violates Google's ToS. Using
  the **Places API** is the compliant path (has cost + rate limits).
- Cold email to businesses is generally legal under CAN-SPAM but requires: no
  deceptive headers, a real physical address, and a working unsubscribe. Cold
  outreach also risks the sending domain's reputation.
- **Deliverability:** bulk cold email should NOT go from the main
  hyperboledigital.com mailbox — it can get the domain flagged and hurt normal
  client email. A separate sending domain/subdomain + warm-up is the right call.

## The 582-email lesson applies double here

This feature is *literally* "send many emails," which is exactly what the email
guardrails (test mode, daily cap, event-driven only, never from a scheduler)
were built to contain after the 582-email incident. Non-negotiables:
- **Mandatory confirm-before-send** — Owen reviews the queued batch and approves.
- Route through the guarded email path (or a dedicated, equally-guarded outreach
  sender) with a daily cap and test mode.
- Follow-ups are **surfaced, not auto-sent** — a "due for follow-up" list Owen
  clicks, matching the platform's no-scheduler principle.

## Proposed shape (when we build)

**Data model (migration)**
- `prospects` — id, name, category, area, phone, email (nullable), website
  (nullable), place_id, rating, review_count, status
  (`new` | `queued` | `reached_out` | `followed_up` | `replied` | `won` | `lost`),
  source, notes, last_contacted_at, created_at.
- `outreach_templates` — id, name, subject, body (with merge fields), step
  (initial | follow_up).

**Phases**
1. **Discovery** (no email involved, safe to build first): a "Find prospects"
   view — pick a category + area (default Tampa), Places search, filter to
   no-website / by rating, one-click save the good ones into `prospects`. Pure
   research, mirrors the keyword-research pattern.
2. **Outreach**: pick a template, it merges per-prospect into a review queue;
   Owen approves the batch; approved ones send via the guarded path and flip to
   `reached_out` with a timestamp.
3. **Follow-up**: a "Due for follow-up" list (prospects `reached_out` > N hours
   ago, default 24–48h, no reply) with a one-click follow-up send. Status →
   `followed_up`.

**Env (later):** enrichment vendor key (if used), dedicated outreach sender
config.

## Open questions before building

- **Email sourcing:** start phone-only + manual email, or pay for an enrichment
  vendor from day one? (Biggest decision — shapes Phase 2.)
- **Sending infrastructure:** set up a separate outreach domain/mailbox to
  protect hyperboledigital.com's reputation? (Recommended yes.)
- Which verticals + area radius for v1? (Tampa + med spas confirmed; what else?)
- Expected volume — tens/day? hundreds? (Affects sender setup + caps.)
- Who owns CAN-SPAM compliance (unsubscribe, physical address in footer)?

## Checkpoint log

- **2026-07-26** — Scoped and deferred (Owen: "set that up as well once we're
  done testing"). Key finding recorded: Places API cleanly handles discovery +
  no-website filter + phone, but **email is the real gap** for the best (no-
  website) targets. Flagged the 582-email guardrail as directly load-bearing:
  mandatory confirm-before-send, guarded sender, follow-ups surfaced-not-auto.
  No code, no migration, no env. Next action = answer the email-sourcing +
  sending-domain questions, then build Phase 1 (discovery only).

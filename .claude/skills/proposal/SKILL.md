---
name: proposal
description: Generate a branded client proposal (scope + pricing breakdown + terms) as a self-contained HTML page that prints cleanly to PDF. Use when the user asks for a proposal, quote, scope of work, SOW, estimate, or pricing breakdown for a client — e.g. "make a proposal for Spec-ID", "quote this new work", "write up the scope for X".
---

# Client proposal generator

Produces a Hyperbole-branded proposal from a scope + pricing list. Output is a
single self-contained HTML file — no build step, no external assets — that
renders in a browser and prints to PDF via Cmd-P.

## Steps

### 1. Gather the inputs

Ask only for what's missing; don't re-ask for anything already in the
conversation.

- **Client name** (e.g. Spec-ID) and, if known, their `clientId` in the platform
- **Title** — what this phase of work is called
- **Intro** — 1–2 sentences framing the engagement and the payment shape
- **Line items** — for each: name, one-sentence description, rate label, amount
- **Terms** — payment timing, what happens after, timeline
- **Proposal date** (default: today)

### 2. Validate the money before rendering

This is the step that matters most — a proposal with wrong arithmetic is worse
than no proposal.

- Line item amounts **must** sum to the stated total. Compute it, don't trust it.
- If a line is a multiple (`$400/mo × 3 mo`), verify rate × quantity = amount.
- Format every figure as `$X,XXX.00` — two decimals, thousands separator.
- If a number doesn't reconcile, **stop and ask** rather than rendering a
  plausible-looking total.

### 3. Fill the template

Copy `template.html` and replace the marked placeholders. Line items are a
repeated `<section class="item">` block — duplicate or delete as needed.

Placeholders: `{{TITLE}}`, `{{CLIENT}}`, `{{DATE}}`, `{{TOTAL}}`, plus the
`<!-- ROW -->` (with `{{ITEM_NAME}}`, `{{ITEM_TIMELINE}}`, `{{ITEM_DESC}}`,
`{{ITEM_TOTAL}}`) and `<!-- TERM -->` repeat blocks.

Break long item names across two lines with `<br>` — the label column is 151pt
and the design sets them in uppercase, so they wrap awkwardly otherwise.

## Design source of truth

The template reproduces a Figma frame. **Do not restyle it from taste — if the
look needs to change, change it in Figma and re-read the frame.**

- File `OnA2gff7NRfZVumPMCwJ44` ("Project Proposal Template"), node **`405:3`**
  (note: `405:2` is the *page*; passing it to `get_design_context` errors with
  "nothing selected")
- Frame is 595×842 — A4 at 72dpi, so **1 Figma unit == 1pt**. The stylesheet is
  written in `pt` for that reason and maps 1:1 to the design.
- Colors: `#333333` (Gray 1 — text and rules), `#828282` (Gray 3 — the "Total"
  label), `#fafafa` page, pure black item names
- Grid: 31pt margins; label column 31→182, content column 182→563 (381pt)
- Rules are 5pt-tall solid bars, not hairlines
- **Money format follows the design: `$ 2,200`** — space after the sign, no
  decimals, thousands separator

**Font:** the file uses **TT Norms Pro**, which is licensed and can't be
embedded. The stack lists it first (so it renders exactly on a machine that has
it) and falls back to Figtree, the closest free geometric face.

**Two sections are extensions, not from the frame:** the grand total and the
terms block. The Figma frame stops at per-item totals. Both were built in the
same language — same grid, same 5pt rule, same uppercase label column — so they
read as part of the system.

### 4. Write and verify

- Write to `proposals/<client-slug>-<yyyy-mm-dd>.html`
- Open it headless and screenshot it, then **look at the screenshot** — check
  the total lines up, nothing overflows, and the terms block renders. A
  proposal is a document someone else reads; don't ship it unseen.

### 5. Offer delivery

Ask how they want it delivered:
- **PDF** — open in a browser, Cmd-P → Save as PDF (the print CSS is tuned for this)
- **Shareable link** — publish via the Artifact tool for a hosted page
- **File only** — leave it on disk

## Rules

- **Never invent scope, prices, or dates.** Every figure comes from the user. If
  something is missing, ask.
- **Never invent social proof** — no fake testimonials, logos, case-study
  numbers, or client counts.
- Keep descriptions to one sentence. A proposal is scanned, not read.
- Say what a line item *is*, not how impressive it is.

## Related

- `lib/tiers.ts` — the platform's productised pricing (retainer tiers). Use it
  when a proposal references an ongoing plan, so quoted numbers match what the
  dashboard shows.
- `lib/prospect-previews.ts` — existing token-gated public page machinery. If
  proposals ever move into the dashboard as a first-class feature with
  per-client storage and a shareable link, that's the pattern to reuse.

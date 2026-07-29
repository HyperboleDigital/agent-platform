# Plan: Automated Website Rebuild (Framer)

**Status:** approved, feasibility spike in progress. Built **second**, after SEO
Phase 0. **Owner:** Owen. **Started:** 2026-07-15.
**Sibling plan:** [seo-automation.md](./seo-automation.md) (built first; this
plan reuses its crawler).

> Living document — append to the **Checkpoint log** as work/decisions happen.

## Goal

For a client with an outdated site: ingest their existing site (brand, main
pages, copy, images) and rebuild it — improved and SEO-clean — on **Framer**, a
platform *we* control. Semi-automated so it's fast and cheap to deliver.

## Why this is the keystone (not a side quest)

To do SEO frictionlessly we need control of the site. Owning it turns the SEO
plan's Phase 2 from "we deliver change-request suggestions" into "we just make
the site better directly." It's also the stickiest position an agency can hold:
a client on *our* Framer site + *our* SEO retainer effectively cannot leave. The
rebuild is the on-ramp to recurring revenue, not a one-off transaction.

## Decisions (locked 2026-07-15)
- **Framer is the platform** (has MCP + API; we already publish to Framer CMS via
  `lib/framer.ts`). **Webflow** is the viable fallback.
- **Never** hand-roll a custom Claude/Vercel/Next site for a *client's* website.
- **Human-designed custom builds ($10–15k) stay as the premium tier.** Selling
  point: *"real human design, not AI slop."* The automated rebuild does not
  cannibalize this — different buyer.

## Positioning & pricing

> **PARTLY SUPERSEDED 2026-07-21.** The finalized offer sheets price builds as:
> **Local Services — $8,500 standalone, $4,500 with a 6-month retainer
> commitment.** **B2B — $12,000–18,000, scoped per project, not discounted.**
> There is **no separate "Rapid Rebuild" SKU on the sheet.** Before quoting a
> ~$4–6k automated rebuild, clear it with Owen — as written it undercuts the
> sheet's own $4,500 retainer-bundled build.
>
> The strategic logic below still holds, and the sheet already encodes it: the
> $8,500 → $4,500 drop for a 6-month commitment *is* the "subsidize the build to
> lock in recurring revenue" play, just expressed as a discount rather than a
> distinct product.

- **Custom (premium): $10–15k** — human-designed, "no AI slop." *(Sheet says
  B2B builds are $12–18k; the local standalone build is $8,500.)*
- ~~**Rapid Rebuild (automated): ~$4–6k**~~ — not a sheet SKU. The automation is
  still worth building as a **margin play on the existing prices**: deliver the
  $4,500/$8,500 build faster and cheaper, rather than introducing a lower price
  point.
- **The power move: bundle the build into the retainer** at a steep discount —
  already live on the sheet as $8,500 → $4,500 with a 6-month commitment. We
  *want* to subsidize the build because owning the site makes the recurring
  revenue frictionless and unkillable. A discounted build that locks in a
  $1,200–2,400/mo retainer pays for itself many times over.

## Feasibility spike — findings (desk research 2026-07-15)

**Verdict: feasible on Framer, with a caveat.** Framer 3.0 shipped real
developer APIs:
- **Server API** — update + publish a Framer project headlessly from a server
  script (the headless publish leg).
- **Canvas API** — programmatic page construction: layout traits (stack, grid,
  padding, gap), borders, components, variants. This is actual design-building,
  not just content.
- **Code File API** — create/manage code files in a project.
- **CMS Plugin API v3** — full CMS control (already used by `lib/framer.ts`).
- **Framer MCP servers exist** (e.g. `superprat/framer-design-mcp-server`) that
  let an LLM create pages/frames/text/components/styles and **screenshot to
  visually verify** each edit.
- **Framer AI** generates a complete multi-page site (layout, copy, images, nav,
  responsive) from a text description — but that's an in-product feature.

**Caveat:** the MCP/Plugin path drives a *currently-open* Framer project via a
secure tunnel (agent-assisted, human editor open) — not yet fully headless.
Realistic v1 = agent constructs pages inside a running Framer session + Server
API publishes. Fully headless "prompt → published, zero human" is not cleanly
proven yet.

**Webflow fallback confirmed:** Designer API creates pages/elements/styles;
enterprise-only API creates a whole site from a template (`templateName`); strong
programmatic SEO/OG + CMS control.

**Next spike step (hands-on, not yet done):** stand up a Framer MCP against a
throwaway project and test agent-driven creation of 3–4 real pages from a brand +
page list, then publish via Server API. Measure effort + token cost + output
quality. Record result in the log below.

## Design-first workflow (Framer's real superpower)

Framer collapses the design→dev handoff: the design *is* the running site, so
there's no separate "build" step and no drift between mockup and product. The
rebuild flow is therefore **generate → live preview → adjust → publish**, which
is what lets the Rapid Rebuild tier be fast *and* cheap without being slop.

- **Reuses the existing review lifecycle.** `lib/content.ts` already runs
  `draft → in_review → approved → published`. The rebuild is the same pattern,
  where the "draft" is a live Framer preview URL. There is always a human gate
  before publish — this is the answer to "how does the automated tier avoid AI
  slop": AI drafts, human approves/nudges, Framer publishes.
- **Cheap, pluralistic iteration.** The agent can generate 2–3 design directions
  (layouts/themes) at preview URLs; client picks one; agent refines. Real art
  direction at software speed.
- **Speculative redesign = sales weapon.** Generate a redesign of a *prospect's
  own* site and hand them a live preview URL ("here's what your site could look
  like"). The visual twin of the free instant audit — same top-of-funnel logic,
  more emotional punch, very hard to say no to.
- The spike caveat (Canvas edits run through the tunnel/open-project model, human
  editor open) aligns with this rather than fighting it — the design-first flow
  wants a human in the loop anyway; the tunnel constraint and the quality gate
  are the same moment.

## Pipeline (reuses the SEO crawler — why this is built second)
1. **Ingest** the client's existing site with the SEO plan's DataForSEO crawler
   (pages, structure, copy, images) + extract brand (logo, palette, fonts).
2. **Improve** — Claude regenerates structure/copy: SEO-clean, single-H1,
   schema-ready. (Rebuild ≠ clone — cloning a bad site reproduces its problems.)
3. **Construct** in Framer via Canvas/Plugin API (MCP), screenshot-verify.
4. **Publish** via Framer Server API after human review.

## Sequencing
Second, after SEO Phase 0 delivers the crawler. The two form one funnel: free
audit hooks them → rebuild gives us control → SEO retainer is the recurring
engine.

## Sources
- [Framer 3.0 for Developers (APIs & workflows)](https://medium.com/@tauhid.uiux/framer-3-0-for-developers-complete-guide-to-new-apis-workflows-3aeb65e840b9)
- [Framer Developers: Server API](https://www.framer.com/developers/server-api-introduction)
- [framer-design-mcp-server (GitHub)](https://github.com/superprat/framer-design-mcp-server)
- [Framer MCP server (dictionary)](https://www.framer.com/dictionary/mcp-server)
- [Webflow Designer API: Create page](https://developers.webflow.com/designer/reference/create-page)
- [Webflow: Create Site (enterprise, template)](https://developers.webflow.com/data/reference/enterprise/workspace-management/create)

## Control benefits (why owning the site compounds)
- **Native alt text** — Framer's built-in/AI alt-text means rebuilt clients get
  image alt text handled by the platform, so the SEO pipeline doesn't need a
  custom vision build for them (see seo-automation.md decision, 2026-07-15).
- (Add more as they surface — every platform feature we inherit is a fix we
  don't have to build or apply manually.)

## Checkpoint log
- **2026-07-21 (pricing reconciled against the finalized offer sheets)** — No
  build work on this plan; the Positioning & pricing section was corrected after
  Owen supplied the finalized offer sheets. **The ~$4–6k "Rapid Rebuild" SKU
  does not exist on the sheet** and as written undercuts the sheet's own $4,500
  retainer-bundled local build — don't quote it without clearing it with Owen.
  Real numbers: local $8,500 standalone / $4,500 with a 6-month retainer; B2B
  $12–18k, not discounted. The subsidize-the-build strategy this plan argues for
  is already encoded in that $8,500 → $4,500 drop, so the automation's value is
  a **margin play at existing prices**, not a new lower price point. Hands-on
  Framer spike still pending, still blocked on a throwaway project + credentials.
- **2026-07-15** — Plan approved. Framer chosen (Webflow fallback), custom $10–15k
  premium kept as "no AI slop." Desk-research feasibility spike done (findings
  above): Framer 3.0 Server/Canvas/Plugin APIs + MCP make agent-driven page
  construction feasible, caveat = tunnel/open-project (not fully headless yet).
  Hands-on spike (build 3–4 pages on a throwaway project) still pending. Note:
  `lib/framer.ts` already does CMS publishing, so the content half is solved.
- **2026-07-15** — Added the design-first workflow section (Owen's insight):
  Framer collapses design→dev, so the product flow is generate → live preview →
  adjust → publish, reusing the `lib/content.ts` review lifecycle with a live
  preview URL as the "draft" = built-in human quality gate (the anti-slop
  answer). Also logged the **speculative-redesign preview as a sales weapon**
  (visual twin of the free audit).

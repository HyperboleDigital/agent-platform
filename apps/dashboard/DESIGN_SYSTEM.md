# Agent Platform — Dashboard Design System (Phase 3 plan)

Status: **proposal for review** (not yet implemented). Goal: take the dashboard
from "functional but plain inline styles" to a product that reads like Linear /
Vercel / Stripe / Retool — restrained, dense-but-calm, dark-mode-native.

The engine's raw rec was a generic blue "BI dashboard." We're going a level up
from that: one confident brand accent, a disciplined neutral scale, real depth,
excellent type. Decisions below are concrete; the **one genuine open decision is
the brand accent color** (see §2).

---

## 1. Stack decision

- **Tailwind CSS + shadcn/ui** (Radix primitives under the hood). This is the
  de-facto stack behind most "billion-dollar-looking" React dashboards, and
  shadcn gives us accessible, unstyled-then-tokened components we own the code
  for (no runtime dep lock-in).
- Adds to the Vite app: `tailwindcss`, `postcss`, `autoprefixer`, `tailwind-merge`,
  `clsx`, `class-variance-authority`, `lucide-react` (icons), `sonner` (toasts).
- **Dark mode:** class-based (`darkMode: 'class'`), theme stored per-user, default
  to system preference. Both themes are designed together, not inverted.
- Migration is **incremental**: stand up the token layer + app shell first, then
  convert pages one at a time. The current `ui.tsx` inline-style helpers get
  retired as each page moves over.

## 2. Color — token architecture (light + dark)

Three layers: **primitive** (raw scale) → **semantic** (role) → **component**
(consumed in code). Components never reference raw hex; only semantic tokens.

### Brand accent — DECISION NEEDED
Recommendation: **keep the violet heritage** (current `#6C5CE7`, also the widget
default) but promote it to a real, tuned scale. Violet reads "modern AI" and
keeps continuity with the embeddable widget. Two alternates if the team wants a
different direction:

| Option | Primary 600 | Feel | Note |
|---|---|---|---|
| **A. Violet (recommended)** | `#6D5CE7` | Modern, AI, distinctive | Keeps widget continuity |
| B. Indigo/Blue | `#4F46E5` | Trust, enterprise, safe | More generic BI look |
| C. Emerald | `#059669` | Growth, fresh | Diverges from widget brand |

Full violet scale (option A): `50 #F4F2FE`, `100 #E7E3FD`, `200 #C9C1FA`,
`300 #A99BF6`, `400 #8B78F0`, `500 #7663EA`, `600 #6D5CE7`, `700 #5847C4`,
`800 #47399C`, `900 #362B77`. (Exact values get contrast-tuned during build.)

### Neutrals (the real workhorse — a dashboard is 90% neutral)
Cool-gray "slate" ramp, `0`→`950`. Light UI sits on `slate-50` surfaces with
`white` cards; dark UI sits on `slate-950` with `slate-900` cards.

### Semantic tokens (map per theme)
`background`, `surface`, `surface-raised`, `foreground`, `muted`,
`muted-foreground`, `border`, `input`, `ring`, `primary` / `primary-foreground`,
`accent`, and status: `success` (emerald), `warning` (amber), `danger` (red),
`info` (sky). Each defined as CSS variables under `:root` and `.dark`.

### Status usage (never color-alone — always icon or text too)
- Subscription active → success; past_due → warning; canceled → muted/danger
- Connector ok/error/not-connected → success / danger / muted
- Escalation open → warning; resolved → muted

## 3. Typography

- **UI font: Plus Jakarta Sans** (Google Fonts) — a warmer, more distinctive
  alternative to Inter that still reads utterly professional. (Inter is the
  ultra-safe fallback if the team prefers maximum neutrality.)
- **Numeric/mono: JetBrains Mono** for IDs, tokens, API keys, and — critically —
  **tabular figures in all data tables and metric tiles** so numbers don't jitter.
- **Type scale** (rem): 12 / 13 / 14 (base body) / 16 / 18 / 20 / 24 / 30 / 36.
  Weights: 400 body, 500 labels/UI, 600 headings. Line-height 1.5 body, 1.2 headings.
- Data-dense but readable: 13px is the table/label workhorse, 14px body.

## 4. Spacing, radius, shadow, motion

- **Spacing:** 4px base scale (`1`=4 … `2`=8, `3`=12, `4`=16, `6`=24, `8`=32…).
  Dense dashboards live at 8–16px gutters, not 24–32.
- **Radius:** `sm` 6px (inputs/badges), `md` 8px (buttons/cards), `lg` 12px
  (panels/modals), `full` (pills/avatars).
- **Shadow (subtle, one scale):** `xs` hairline, `sm` cards, `md` popovers/dropdowns,
  `lg` modals. Dark mode leans on border + surface elevation more than shadow.
- **Motion:** 150–200ms ease-out for hover/state; respect `prefers-reduced-motion`.
  No decorative animation; motion only conveys cause→effect.

## 5. App shell & information architecture

Replace the current flat "list → detail-with-tabs" with a **persistent left
sidebar + top bar** app shell (the ≥1024px pattern; collapses to a drawer on
mobile).

- **Top bar:** workspace/client switcher (left), global search, theme toggle,
  Clerk `UserButton` (right).
- **Sidebar nav — role-aware:**
  - **Superadmin console:** Overview (platform KPIs) · Clients · Revenue ·
    Usage · Settings. Cross-tenant.
  - **Client view (scoped):** Overview · Conversations · Leads · Knowledge ·
    Connectors · Billing · Settings. Only their own org's data.
- The existing client-detail **tabs become sidebar sections** within a selected
  client's workspace — less nesting, more "app," deep-linkable URLs per section.
- Active location always highlighted; nav items have icon + label.

## 6. Component inventory (shadcn/ui)

Build/adopt these, tokened to the system above:
`Button` (primary/secondary/ghost/destructive), `Card`, `Badge` (status variants),
`Table` (sortable, sticky header, row hover, zebra optional), `Tabs`, `Dialog`,
`DropdownMenu`, `Input`/`Textarea`/`Label`/`Switch`/`Select`, `Toast` (sonner),
`Skeleton`, `Tooltip`, `Avatar`, `Separator`, `Sheet` (mobile nav),
`Command` (⌘K search later), plus app-specific: `StatTile` (label + big number +
delta + sparkline), `EmptyState`, `PageHeader`.

## 7. Charts (recharts, themed to tokens)

- **Trends over time** (conversations, leads/week): **line/area**, brand accent
  stroke, subtle `border`-colored gridlines, tooltip on hover.
- **Usage vs plan cap** (conversations vs 500/2500): **progress bar or bullet** —
  the clearest "how close to the limit" read; also drives upgrade prompts.
- **Comparisons** (leads by intent, resolution breakdown): **horizontal bar**.
- **Stat tiles** get inline **sparklines** for at-a-glance trend.
- All charts: token-driven colors, empty state ("No data yet"), skeleton while
  loading, ≥3:1 data contrast, never color-alone.

## 8. Polish patterns (the stuff that makes it feel finished)

- **Toasts (sonner):** success/error/info. **First concrete win:** the
  `?billing=success` / `?billing=cancelled` redirect param (already emitted by
  the API) → toast "You're now on the Starter plan 🎉" / "Checkout canceled."
- **Empty states:** every table/list gets an icon + one-line explanation + a
  primary action (e.g. Leads → "No leads yet — leads captured by your assistant
  show up here").
- **Loading:** skeleton rows/cards (not spinners) for anything >300ms.
- **Error:** inline error card with a retry, never a blank screen; generic
  user-facing copy (details stay in logs).
- **Confirm destructive actions** (delete knowledge doc, cancel plan) via Dialog.

## 9. Build order (when approved)
1. Token layer + Tailwind/shadcn setup + theme toggle (foundation).
2. App shell (sidebar + topbar + role-aware nav).
3. Billing success/cancel **toast** (quick, visible win).
4. Convert pages: Overview → Clients → client sections (Conversations, Leads,
   Knowledge, Connectors, Billing, Config), each with empty/loading/error states.
5. Charts on Overview + Usage.
6. Superadmin platform Overview (revenue/usage rollups) last — depends on new
   aggregate endpoints.

## Open decisions for the team
1. **Brand accent** (§2): violet (recommended) vs indigo vs other.
2. **UI font:** Plus Jakarta Sans (recommended) vs Inter (safest).
3. Whether the superadmin platform-rollup views are in this phase or deferred
   (they need new aggregate API endpoints).

# Plan: Client Contracts + E-Signature

**Status:** direction LOCKED IN (Dropbox Sign), build deferred. No code yet.
**Owner:** Owen. **Scoped:** 2026-07-26. **Vendor committed:** 2026-07-26.
**Decision on approach:** integrate Dropbox Sign (formerly HelloSign) — a real
e-signature vendor rather than build signing in-house, because the signature
must be legally defensible. Owen confirmed the Dropbox Sign recommendation on
2026-07-26; build is deferred until there's a Dropbox Sign account + API key
and the first template's terms are reviewed.

> Living document. Append to the Checkpoint log when anything changes.

## Goal

From a client's project details, an admin drafts a contract and sends it for
signature with one click. The client signs in a court-tested flow; the signed
document + status come back and are visible on the client's dashboard. No more
bouncing to email + a separate signing tool by hand.

## Why a vendor, not in-house

A "type your name + click agree" box we build ourselves is easy, but the whole
*point* of a contract is enforceability. Vendors (DocuSign, Dropbox Sign, ex-
HelloSign) provide the parts that make a signature hold up: identity
verification, a tamper-evident audit certificate (who/when/IP/consent), ESIGN/
UETA compliance, and signed-PDF storage. We should own the *contract content
and workflow*, and let them own the *signature's legal validity*.

## Recommended vendor

**Dropbox Sign (formerly HelloSign)** over DocuSign for our size:
- Simpler API, cleaner developer experience.
- Cheaper at low volume; DocuSign's per-envelope pricing and sales-led plans are
  overkill for a handful of contracts/month.
- Embedded signing (client signs inside our dashboard via an iframe/redirect,
  not a DocuSign-branded external page) is straightforward.
- Templates + merge fields cover "draft from project details" cleanly.

Revisit DocuSign only if a client contractually requires it, or volume grows
enough that its ecosystem matters.

## The flow (embedded signing)

1. **Admin drafts** — on the client's page, an admin picks a contract template
   and fills/confirms merge fields pulled from the client + project (client
   name, scope of work, price/tier, start date, term). We assemble the payload.
2. **Send for signature** — one click calls the vendor API to create a
   *signature request* from our template + merge data, with the client's email
   as signer.
3. **Client signs** — client opens it from their dashboard (embedded signing
   URL rendered in an iframe) or a vendor email link. They sign in the vendor's
   compliant flow.
4. **Webhook back** — vendor fires a webhook on signed/declined/viewed. We
   verify its signature, update our `contracts` row status, and pull the signed
   PDF (store the vendor's file URL/id, optionally cache the PDF in Supabase
   storage).
5. **Visible on dashboard** — the client (and admin) see contract status
   (draft / sent / viewed / signed / declined) and can download the signed PDF.
   A signed contract could optionally gate/annotate project kickoff.

## Pieces to build (when we do)

**Backend**
- `lib/contracts.ts` — CRUD over a `contracts` table; vendor API calls (create
  signature request, get status, download signed file); webhook handler with
  signature verification.
- Routes under `/clients/:id/contracts` — list, create/draft, send, get
  embedded-sign URL, download; plus a public `/webhooks/esign` (verified by
  vendor HMAC, NOT behind requireAuth — same shape as the Stripe webhook).
- Env: `ESIGN_API_KEY`, `ESIGN_CLIENT_ID` (embedded), `ESIGN_WEBHOOK_SECRET`.

**DB (migration)**
- `contracts` — id, client_id, template_key, status, vendor_request_id,
  merge_data (jsonb), signed_file_url, sent_at, signed_at, created_by, timestamps.

**Frontend**
- A **Contracts** section on the client page (admin: draft/send/track; client:
  view/sign/download). Nav placement TBD — likely near Billing, or inside it.
- Draft modal: template picker + merge-field form prefilled from client/project.
- Embedded signing view (iframe) + status badges.

**Templates**
- Author 1–2 real templates in the vendor's template editor first (e.g. a
  website-build agreement, a monthly-retainer agreement) with merge fields.
  This is content/legal work, not code — and should be reviewed by someone who
  can vouch for the terms.

## Open questions before building

- Which contracts do we actually need first? (website build vs retainer — start
  with the one tied to the upcoming Suite Route website deal.)
- Should a signed contract gate anything in the product (e.g. project kickoff,
  or unlock alongside the billing-active state), or is it purely record-keeping?
- Do we want the signed PDF mirrored into Supabase storage, or is the vendor's
  hosted copy + link enough?
- Who reviews the contract *terms* for legal soundness? (Out of scope for code,
  but blocks going live.)

## Cost

Dropbox Sign: roughly a low monthly base + per-request pricing at small volume —
pennies-to-a-couple-dollars per contract, far below DocuSign. Confirm current
pricing at build time.

## Checkpoint log

- **2026-07-26** — Scoped. Owen chose "scope the DocuSign/vendor path, don't
  build yet." Recommendation recorded: Dropbox Sign over DocuSign for our size,
  embedded signing. No code, no migration, no env added. Next action = decide
  first template + whether a signed contract gates anything, then Phase 1
  (schema + vendor account + one template).

# Clerk → Production Instance Migration

Status: **DONE** (completed 2026-08-07). Deployed app now runs on a dedicated
Clerk production instance; localhost stays on the dev instance. Replaces the
"still on test keys" note in HANDOFF.md.

## Gotcha that cost real time (read this if migrating another instance)

After every key/DNS/Google step checked out, sign-in still looped back to
`/sign-in` with **no error**. Cause: the production instance was cloned with
**`sign_up.mode = "restricted"`**, and the prod user database starts **empty**.
First Google sign-in is really a *sign-up* (Clerk transfers sign-in→sign-up for
a first-time user), which restricted mode silently blocks → bounce to sign-in,
`__client_uat=0`, nothing in the console. Fix: temporarily set Sign-up mode to
**Public** (Clerk → Configure → Restrictions), sign in once to seed the owner
user, then set it **back to Restricted**. Diagnosed by reading the public FAPI
config: `curl https://clerk.hyperboledigital.com/v1/environment`.

## Context / decisions

- Today localhost **and** the Vercel/Render deploy all share ONE Clerk
  **development** instance (`pk_test_`/`sk_test_`). This moves the deployed app
  onto a dedicated **production** instance while localhost keeps the dev one.
- Code needs **no changes**: the API reads `CLERK_*` from env via
  `@clerk/express` (no hardcoded issuer), the dashboard reads
  `VITE_CLERK_PUBLISHABLE_KEY`. This is entirely env swaps + dashboard config.
- A production instance is a **brand-new empty database** — new user pool, new
  org list, and Clerk's shared Google OAuth credentials stop working (you must
  supply your own).
- Decisions locked: only the owner login exists today (no client Orgs to
  remap). **Application domain entered in Clerk = `hyperboledigital.com`**
  (the apex; the app runs on the `app.` subdomain and shares first-party
  cookies with it), which makes the Clerk frontend API host
  **`clerk.hyperboledigital.com`** and the Google OAuth callback
  **`https://clerk.hyperboledigital.com/v1/oauth_callback`**.

## DNS records to add at GoDaddy (all type CNAME)

GoDaddy's "Name" field is just the host — it appends the apex automatically, so
enter only the left column. No trailing dot on the value. TTL default (1hr) is
fine. Remove any conflicting existing record at the same host first.

| Name (host)        | Value (points to)                    | Purpose            |
|--------------------|--------------------------------------|--------------------|
| `clerk`            | `frontend-api.clerk.services`        | Frontend API       |
| `accounts`         | `accounts.clerk.services`            | Account portal     |
| `clkmail`          | `mail.w5jvtkasp59o.clerk.services`   | Clerk email send   |
| `clk._domainkey`   | `dkim1.w5jvtkasp59o.clerk.services`  | DKIM 1             |
| `clk2._domainkey`  | `dkim2.w5jvtkasp59o.clerk.services`  | DKIM 2             |

Skip the "Proxy configuration" (Optional). After adding all five, click Verify
in Clerk — propagation can take minutes to a couple hours.

## localhost is unaffected — do NOT touch these

Keep `pk_test_`/`sk_test_` in `apps/dashboard/.env.local` and `apps/api/.env`.
Live keys reject `localhost` origins and would break local login. The whole
point of the split: dev instance = branch testing, prod instance = real users.

## Checklist

- [x] **1. Create production instance** — Clerk dashboard → top switcher →
      Create production instance (clone from Development). Mints
      `pk_live_`/`sk_live_`. Never commit these.
- [x] **2. DNS at GoDaddy** — add the ~5 CNAMEs Clerk lists (frontend API
      `clerk`, accounts portal, `clkmail`, DKIM x2) next to the existing
      `api`/`app` CNAMEs. Frontend API host = `clerk.hyperboledigital.com`.
      Wait for Clerk to verify (DNS propagation).
- [x] **3. Google OAuth (own credentials, required for prod)** — in the
      existing GCP project (the one used for Gmail/GSC), create an OAuth 2.0
      **Web** client. Add Authorized redirect URI exactly as Clerk shows:
      `https://clerk.hyperboledigital.com/v1/oauth_callback`. Configure +
      publish the OAuth consent screen (else Google shows "unverified app").
      Paste client ID + secret into Clerk → Production → SSO Connections →
      Google (custom credentials).
- [x] **4a. Vercel (dashboard)** — set `VITE_CLERK_PUBLISHABLE_KEY` = `pk_live_…`,
      redeploy.
- [x] **4b. Render (API)** — set `CLERK_PUBLISHABLE_KEY` = `pk_live_…` and
      `CLERK_SECRET_KEY` = `sk_live_…`. (Do NOT set PORT — Render injects it.)
- [x] **5. Re-seed superadmin** — sign into `app.hyperboledigital.com` via
      Google once to create the prod user. Copy the **prod** Clerk user ID
      (Clerk → Users) → set Render `SUPERADMIN_USER_IDS` to it. The dev user ID
      does NOT carry over.
- [x] **6. Verify** — prod: Google sign-in works, dashboard loads data (API
      reaches Supabase), superadmin cross-tenant access works. localhost: still
      logs in on the dev instance, unaffected.

## When real clients arrive later

Each client = one Clerk **Organization** whose id is stored in
`clients.clerk_org_id`. Those must be created in the **production** instance and
the DB updated to match. Not needed now (no client orgs exist yet).

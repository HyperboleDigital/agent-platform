-- Per-client manual job control (Owen, 2026-08-25). Two flags:
--
-- admin_disabled — a superadmin explicitly turned this job OFF for this
-- client. The reconcile sweep's old contract was "entitlements are
-- authoritative": it re-enabled any disabled job the client's tier promised
-- within the hour, which made the disable toggle useless as a deliberate
-- opt-out ("this customer doesn't need weekly rank checks"). Reconcile now
-- leaves admin_disabled rows alone; re-enabling from the UI clears the flag.
-- Entitlement REMOVAL still disables rows without setting it.
--
-- admin_added — a superadmin explicitly scheduled this job for a client whose
-- entitlements DON'T promise it (e.g. a not-yet-onboarded client with no
-- tier). Reconcile normally disables rows outside the desired set; it leaves
-- admin_added rows alone. These rows may also be deleted outright from the
-- UI (entitlement-provisioned rows are only ever disabled, keeping history).
--
-- Safe to run; idempotent; additive only.

alter table scheduled_jobs add column if not exists admin_disabled boolean not null default false;
alter table scheduled_jobs add column if not exists admin_added boolean not null default false;

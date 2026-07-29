-- Additive — distinguish "site genuinely isn't served over HTTPS" from "the
-- TLS check itself failed" (connection error, timeout, handshake rejected) on
-- site_health_checks. Both cases left ssl_valid null before, which the
-- dashboard displayed as the same misleading "Not served over HTTPS" message
-- even when the site does serve HTTPS but the check errored — e.g. a stale
-- DNS record round-robining some requests to a dead host. Safe to run.

alter table site_health_checks add column if not exists ssl_error text;

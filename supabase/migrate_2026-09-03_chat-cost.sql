-- Per-message LLM cost instrumentation for chat (2026-09-03).
--
-- Chat was the one LLM spender with no cost record: generation runs write
-- cost_micros, scheduled jobs write cost_cents, but message_logs stored only
-- intent/confidence. These columns let the superadmin "AI spend this month"
-- card add chat to the ledger, and give per-client cost data for pricing.
--
-- cost_micros matches prospect_generation_runs: millionths of a USD, integer,
-- because per-message costs are fractions of a cent and cents would round
-- most of every message away.
--
-- lib/logs.ts degrades gracefully pre-migration (falls back to the legacy
-- insert), so deploy order doesn't matter — but no chat cost is recorded
-- until this runs.

alter table message_logs add column if not exists model         text;
alter table message_logs add column if not exists input_tokens  integer;
alter table message_logs add column if not exists output_tokens integer;
alter table message_logs add column if not exists cost_micros   bigint;

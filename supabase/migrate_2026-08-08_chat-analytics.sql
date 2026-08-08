-- Chat analytics / client reporting layer.
-- Adds conversation-level instrumentation to message_logs, links leads to the
-- session that produced them, and exposes a chat_sessions view for
-- conversation-level metrics. Purely additive: every new column is nullable or
-- defaulted so existing rows keep counting as conversations (they just have
-- null text/confidence/session — charts fill in from the first post-migration
-- message forward). Safe to re-run.

-- ── message_logs: per-message instrumentation ────────────────────────────────
-- session_id groups a page-visit's messages into one conversation. It's the
-- widget's `from` (sess_<rand>, one per page load — see apps/widget/src/widget.js);
-- storing it here is what makes the chat_sessions view below possible without
-- touching the widget's public API.
alter table message_logs add column if not exists session_id text;
alter table message_logs add column if not exists user_message text;
alter table message_logs add column if not exists assistant_response text;
-- Real retrieval confidence (top knowledge-base match cosine similarity, 0..1),
-- NOT the old intent-derived heuristic. Null for pre-migration rows.
alter table message_logs add column if not exists confidence real;
alter table message_logs add column if not exists escalated boolean not null default false;
alter table message_logs add column if not exists escalation_reason text;
-- Who ultimately handled the turn. 'agent' = answered by the bot,
-- 'human' = escalated / low-confidence hand-off, 'abandoned' = derived at the
-- session level (a conversation that went cold with no resolution or lead — see
-- the view). Message rows only ever write 'agent' | 'human'.
alter table message_logs add column if not exists resolved_by text
  check (resolved_by in ('agent', 'human', 'abandoned'));
-- Which of the four orchestrator tools fired this turn.
alter table message_logs add column if not exists tools_used text[] not null default '{}';
-- knowledge_base chunk ids retrieved for the answer (powers KB coverage).
alter table message_logs add column if not exists retrieved_doc_ids uuid[] not null default '{}';
-- The query embedding searchDocs already computes at answer time — stored free
-- here so Top Questions can cluster by semantic similarity without re-embedding.
alter table message_logs add column if not exists query_embedding vector(1024);

-- Fast per-session lookups for the chat_sessions view and transcript export.
create index if not exists message_logs_session_idx
  on message_logs (client_id, session_id, created_at);
-- Partial index: the Unanswered view scans only escalated/low-confidence rows.
create index if not exists message_logs_escalated_idx
  on message_logs (client_id, created_at desc) where escalated;

-- ── leads: link back to the conversation that captured them ───────────────────
-- Nullable — contact-form leads and pre-migration leads have no session.
alter table leads add column if not exists session_id text;
create index if not exists leads_session_idx on leads (client_id, session_id);

-- ── chat_sessions view: conversation-level metrics ────────────────────────────
-- Derived (not a table) so it can never drift from message_logs and needs no
-- backfill. Every row carries client_id, so the tenant filter that every
-- message_logs query already applies carries straight through — callers MUST
-- still filter by client_id (the analytics lib does).
--
-- Outcome precedence: a session that captured a lead is 'lead'; else if any
-- turn escalated it's 'escalated'; else if the bot answered at least one turn
-- it's 'resolved'; else 'abandoned' (visitor sent messages, got no resolution,
-- left no contact info).
create or replace view chat_sessions as
with per_session as (
  select
    m.client_id,
    m.session_id,
    min(m.created_at)                                as started_at,
    max(m.created_at)                                as ended_at,
    count(*)                                         as message_count,
    bool_or(m.escalated)                             as escalated,
    bool_or(coalesce(m.resolved, false))             as any_resolved
  from message_logs m
  where m.session_id is not null
  group by m.client_id, m.session_id
)
select
  s.client_id,
  s.session_id,
  s.started_at,
  s.ended_at,
  s.message_count,
  s.escalated,
  -- A lead is tied to this session either explicitly (leads.session_id) or,
  -- for the pre-session-link window, by falling back to false.
  exists (
    select 1 from leads l
    where l.client_id = s.client_id and l.session_id = s.session_id
  ) as lead_captured,
  case
    when exists (
      select 1 from leads l
      where l.client_id = s.client_id and l.session_id = s.session_id
    ) then 'lead'
    when s.escalated then 'escalated'
    when s.any_resolved then 'resolved'
    else 'abandoned'
  end as outcome
from per_session s;

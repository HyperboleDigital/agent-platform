-- Additive — a third outreach-email draft variant alongside draft_plain and
-- draft_loom: a fuller "value-prop" email bundling the generated mockup with
-- the agency's other real value props (SEO & AI-visibility, AI Chat
-- Assistant, book-a-call), for once a mockup exists to reference. Kept as its
-- own column rather than overwriting draft_plain so the short and long
-- variants both stay available side by side. Still no send path — the
-- operator copies this into their own inbox exactly like the other drafts.
-- Safe to run.
alter table prospects add column if not exists draft_value text;

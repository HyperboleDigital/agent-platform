-- Optional per-client contact-form fields (company, phone, division/category),
-- surfaced on the widget's "Get in touch" and inline lead-capture forms when a
-- client opts in via widgetConfig.contactFields (see packages/shared).
-- Nullable/additive — existing leads and clients that don't opt in are unaffected.
alter table leads add column if not exists company text;
alter table leads add column if not exists phone text;
alter table leads add column if not exists division text;

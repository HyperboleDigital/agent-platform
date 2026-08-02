-- Per-client chat widget appearance config.
--
-- Previously every widget setting (title, colours, prompts) could only be
-- supplied as a data-* attribute on the embed script tag, which meant changing
-- a client's branding required them to re-paste the snippet into their own
-- website. Storing it here lets the widget fetch its config at load time, so an
-- edit in the dashboard reaches their live site on the next page load.
--
-- Shape (all keys optional — an empty object must render today's defaults):
--   title, tagline, welcome, placeholder   text
--   color, color2, logo, avatarEmoji       text
--   prompts                                text[]  — teaser bubbles above the closed widget
--   chips                                  [{ label, message }] — in-panel buttons, max 4
--
-- Served to the public by GET /widget-config/:clientId, which allow-lists these
-- fields explicitly. Nothing sensitive belongs in this column: a client UUID is
-- visible in the page source of every site that embeds the widget, so treat
-- everything stored here as world-readable.
alter table clients add column if not exists widget_config jsonb not null default '{}'::jsonb;

comment on column clients.widget_config is
  'Public chat-widget appearance config — world-readable via /widget-config/:clientId. No secrets.';

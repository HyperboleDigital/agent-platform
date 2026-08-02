-- Uploaded logos for the chat widget.
--
-- Previously widget_config.logo could only be a URL the operator hosted
-- somewhere else, which meant a client with a logo file and no CDN had no way
-- to use it. This bucket lets the dashboard accept a direct upload.
--
-- Private, like every other bucket here. The bytes are served to the public by
-- GET /widget-config/:clientId/logo — an API route on our own origin — rather
-- than a signed *.supabase.co URL, because the widget renders on client sites
-- indefinitely and a signed URL would expire out from under it.
--
-- The storage path is recorded on clients.widget_config.logoPath; when set it
-- takes precedence over the manually-entered logo URL.
insert into storage.buckets (id, name, public)
values ('widget-logos', 'widget-logos', false)
on conflict (id) do nothing;

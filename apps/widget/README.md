# Widget

Embeddable chat widget — single JS file, zero dependencies, works on any website.

## Local testing

Open `test.html` directly in your browser (no server needed for the HTML).
Make sure your API is running on localhost:3001 first.

## Deploy to Cloudflare Workers (CDN)

1. Go to Cloudflare Dashboard → Workers & Pages → Create Worker
2. Paste the contents of `cloudflare-worker.js` into the editor
3. Update the GitHub raw URL to point to your repo
4. Deploy — you get a URL like `https://agent-widget.yourname.workers.dev`

## One Worker serves every client

The Worker only serves a static `widget.js` — it never sees a client ID and has
no per-client logic. Every client uses the **same** Worker URL; what differs is
the `data-client-id` on their own script tag. Adding clients two and three
requires no Worker changes.

## Client embed snippet

Generated for you per client on the dashboard's **Chat Assistant → Widget
setup** tab. Appearance is stored in the database and fetched at load, so the
snippet is short and the client only ever pastes it once:

```html
<script
  src="https://agent-widget.yourname.workers.dev/widget.js"
  data-client-id="CLIENT_UUID_FROM_SUPABASE"
  data-api-url="https://your-api.railway.app"
></script>
```

## Where settings come from

Each setting resolves in this order:

1. **A `data-*` attribute** on the script tag (below) — always wins, useful for
   pinning one value on one site.
2. **The client's stored config**, edited on the dashboard's Widget setup tab
   and served from `GET /widget-config/:clientId`. Changing it here reaches the
   client's live site without them editing their website.
3. **The built-in default.**

If the config request fails or takes longer than 2s, the widget renders with
built-in defaults rather than not rendering at all.

## Customization via data attributes

Only `data-client-id` and `data-api-url` are needed in practice — everything
else is better set per client in the dashboard. These exist to override the
stored config on one specific site.

| Attribute | Falls back to | Description |
|---|---|---|
| data-client-id | **required** | UUID from your clients table |
| data-api-url | localhost:3001 | Your API base URL |
| data-title | stored config → client name → `Support` | Header title |
| data-tagline | stored config → `You can ask me anything` | Subtitle under the title |
| data-welcome | stored config → `How can I help you today?` | First assistant message |
| data-placeholder | stored config → `Type a message...` | Input placeholder |
| data-color | stored config → `#6C5CE7` | Primary brand color |
| data-color-2 | stored config → primary | Secondary, used in gradients |
| data-logo | stored config → *(none)* | Logo for the bubble and header. Both sit on the brand-colored gradient, so use a light/white mark. |
| data-avatar-emoji | stored config → first letter of title | Avatar when there's no logo |
| data-prompts | stored config → generic 5-question set | Pipe-separated questions that rotate above the closed bubble, e.g. `data-prompts="What's your pricing?\|Can I book a call?"` |

The in-panel quick-reply buttons (shown when a visitor first opens the chat)
have **no attribute** — they're configured per client in the dashboard, since
each one needs both a button label and the message it sends.

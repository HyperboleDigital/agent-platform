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

## Client embed snippet

```html
<script
  src="https://agent-widget.yourname.workers.dev/widget.js"
  data-client-id="CLIENT_UUID_FROM_SUPABASE"
  data-api-url="https://your-api.railway.app"
  data-title="Support"
  data-color="#1D9E75"
  data-welcome="Hi! How can I help you today?"
></script>
```

## Customization via data attributes

| Attribute | Default | Description |
|---|---|---|
| data-client-id | required | UUID from your clients table |
| data-api-url | localhost:3001 | Your Railway API URL |
| data-title | Support | Widget header title |
| data-color | #1D9E75 | Primary brand color |
| data-welcome | Hi! How can I help? | First message shown |
| data-placeholder | Ask us anything... | Input placeholder |

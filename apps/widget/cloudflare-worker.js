// Cloudflare Worker — serves widget.js with correct headers
// Deploy this at: Cloudflare Dashboard → Workers → Create Worker
//
// Set the WIDGET_SOURCE_URL environment variable (Worker → Settings → Variables)
// to the raw URL of widget.js, e.g.
//   https://raw.githubusercontent.com/<user>/agent-platform/main/apps/widget/src/widget.js

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/HyperboleDigital/agent-platform/main/apps/widget/src/widget.js';

// How long a fetched copy is served from Cloudflare's own edge cache before
// this Worker re-fetches from GitHub. This is the ONLY thing standing between
// "every page load on every client site" and "a single origin fetch" —
// without it, every visitor's request re-fetches raw.githubusercontent.com
// directly, and Cloudflare Workers share egress IPs across many customers, so
// GitHub's per-IP rate limit (429) gets hit under completely ordinary traffic,
// not just a spike. When that happened once already, the 429's plain-text
// body ("429: Too Many Requests…") got served to browsers as if it were the
// widget's JS (no status check existed either), breaking the widget on every
// client site at once — see the `widgetRes.ok` check below, which now
// prevents that specific failure from recurring even if this cache layer
// somehow gets bypassed.
const EDGE_CACHE_TTL_SECONDS = 300;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/widget.js') {
      const source = env?.WIDGET_SOURCE_URL || DEFAULT_SOURCE;
      const cache = caches.default;
      // Cache key is stable regardless of the requesting site's own URL/query
      // string — every client site should share ONE cached copy.
      const cacheKey = new Request(source, { method: 'GET' });

      let cached = await cache.match(cacheKey);
      if (cached) return withCors(cached);

      let widgetRes;
      try {
        widgetRes = await fetch(source);
      } catch (err) {
        // Origin unreachable — nothing to serve. A cache miss here means we
        // have no last-known-good copy to fall back to either (Cache API
        // doesn't keep stale entries past their TTL), so this is a real outage.
        return new Response('widget.js temporarily unavailable', { status: 502 });
      }

      if (!widgetRes.ok) {
        // NEVER forward a non-2xx body as if it were valid JS — that's what
        // turned GitHub's 429 error page into "Uncaught SyntaxError" on every
        // client's site. Fail loudly (502) instead of failing silently-wrong.
        console.error(`[widget] source fetch failed: ${widgetRes.status} ${source}`);
        return new Response(`widget.js source unavailable (upstream ${widgetRes.status})`, { status: 502 });
      }

      const js = await widgetRes.text();
      const response = new Response(js, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
          'Access-Control-Allow-Origin': '*',
        }
      });

      // Store at Cloudflare's edge so the NEXT request (any client site,
      // any visitor) is served from cache rather than re-fetching GitHub.
      // waitUntil so this doesn't delay the response to the current visitor.
      ctx.waitUntil(cache.put(cacheKey, response.clone()));

      return response;
    }

    return new Response('Not found', { status: 404 });
  }
};

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(response.body, { status: response.status, headers });
}

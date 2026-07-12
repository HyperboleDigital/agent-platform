// Cloudflare Worker — serves widget.js with correct headers
// Deploy this at: Cloudflare Dashboard → Workers → Create Worker
//
// Set the WIDGET_SOURCE_URL environment variable (Worker → Settings → Variables)
// to the raw URL of widget.js, e.g.
//   https://raw.githubusercontent.com/<user>/agent-platform/main/apps/widget/src/widget.js

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/HyperboleDigital/agent-platform/main/apps/widget/src/widget.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/widget.js') {
      const source = env?.WIDGET_SOURCE_URL || DEFAULT_SOURCE;
      const widgetRes = await fetch(source);
      const js = await widgetRes.text();

      return new Response(js, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

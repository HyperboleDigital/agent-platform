// Cloudflare Worker — serves widget.js with correct headers
// Deploy this at: Cloudflare Dashboard → Workers → Create Worker

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/widget.js') {
      // In production, store widget source in KV or inline it here
      // For now, fetch from your raw GitHub URL
      const widgetRes = await fetch('https://raw.githubusercontent.com/YOUR_USERNAME/agent-platform/main/apps/widget/src/widget.js');
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

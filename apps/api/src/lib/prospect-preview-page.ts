import type { Prospect } from './prospecting'
import type { CrawlIssue } from './dataforseo'

// Returns an HTML string — deliberately NOT a .html file under src/. apps/api
// builds with bare `tsc` and has no asset-copy step, so a static template
// would resolve fine under `tsx watch` locally and throw at runtime on
// Railway. Keeping it a .ts module means the build carries it.

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface PreviewPageInput {
  prospect: Prospect
  // 'html' concepts are iframed from conceptUrl; 'image' is the legacy
  // single-PNG format, still rendered as-sent for links already in inboxes.
  format: 'image' | 'html'
  conceptUrl: string | null
  imageUrl: string | null
  currentScreenshotUrl: string | null
  onpageScore: number | null
  issues: CrawlIssue[]
  bookingUrl: string | null
}

// Everything interpolated here is untrusted or semi-trusted: the prospect name
// comes from Google Places, the issue titles/explanations from DataForSEO and
// an LLM synthesis pass. All of it goes through esc().
export function renderPreviewPage(input: PreviewPageInput): string {
  const { prospect, format, conceptUrl, imageUrl, currentScreenshotUrl, onpageScore, issues, bookingUrl } = input
  const name = esc(prospect.name)

  // The concept is model-authored HTML shown to an outside party, so it is
  // sandboxed with no allow-* tokens at all: no scripts, no forms, no
  // navigation, no access to this page's origin.
  const conceptBlock = format === 'html' && conceptUrl ? `
    <div class="concept">
      <div class="chrome">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="chrome-url">${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com</span>
      </div>
      <iframe class="frame" src="${esc(conceptUrl)}" sandbox title="A homepage concept for ${name}" loading="lazy"></iframe>
    </div>
    <a class="expand" href="${esc(conceptUrl)}" target="_blank" rel="noreferrer noopener">Open the full concept in a new tab &rarr;</a>`
    : imageUrl ? `<img class="mockup" src="${esc(imageUrl)}" alt="A homepage design concept for ${name}">`
    : ''

  const beforeAfter = currentScreenshotUrl ? `
    <div class="ba">
      <div class="ba-col">
        <span class="ba-label">Your site today</span>
        <div class="shot-wrap"><img class="shot" src="${esc(currentScreenshotUrl)}" alt="${name}'s current website"></div>
      </div>
      <div class="ba-col">
        <span class="ba-label ba-label-new">What it could be</span>
        ${conceptBlock}
      </div>
    </div>`
    : conceptBlock

  const scoreBlock = onpageScore === null ? '' : `
    <div class="score">
      <div class="score-num">${Math.round(onpageScore)}<span>/100</span></div>
      <div class="score-label">Current site health score</div>
    </div>`

  const issuesBlock = issues.length === 0 ? '' : `
    <div class="card">
      <h2>What we found on your current site</h2>
      <ul class="issues">
        ${issues.slice(0, 6).map(i => `
          <li>
            <span class="sev sev-${esc(i.severity)}">${esc(i.severity)}</span>
            <div>
              <strong>${esc(i.title)}</strong>
              <p>${esc(i.explanation)}</p>
            </div>
          </li>`).join('')}
      </ul>
    </div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>An idea for ${name}'s website</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         max-width: 1040px; margin: 0 auto; padding: 40px 20px 80px; line-height: 1.6;
         color: #16181d; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e8e8ea; background: #111214; } }
  h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 8px; }
  .sub { color: #6b7280; margin: 0 0 28px; }
  @media (prefers-color-scheme: dark) { .sub { color: #9aa0aa; } }
  .mockup { width: 100%; border-radius: 12px; border: 1px solid rgba(128,128,128,.25); display: block; margin: 0 0 28px; }

  /* Before/after. Single column under 860px — side-by-side screenshots become
     unreadable long before the viewport gets truly narrow. */
  .ba { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 0 0 28px; align-items: start; }
  @media (max-width: 860px) { .ba { grid-template-columns: 1fr; } }
  .ba-col { min-width: 0; }
  .ba-label { display: block; font-size: .75rem; text-transform: uppercase; letter-spacing: .06em;
              font-weight: 600; color: #6b7280; margin: 0 0 8px; }
  .ba-label-new { color: #BA9E66; }
  /* 420px frame + ~39px of chrome, so the two columns bottom-align. */
  .shot-wrap { height: 459px; overflow: hidden; border-radius: 12px;
               border: 1px solid rgba(128,128,128,.25); background: #f6f6f7; }
  .shot { width: 100%; display: block; }

  /* Browser-chrome frame around the live concept. */
  .concept { border-radius: 12px; overflow: hidden; border: 1px solid rgba(128,128,128,.25); background: #fff; }
  .chrome { display: flex; align-items: center; gap: 6px; padding: 9px 12px;
            background: #ececee; border-bottom: 1px solid rgba(128,128,128,.2); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #c9c9cd; flex-shrink: 0; }
  .chrome-url { margin-left: 8px; font-size: .72rem; color: #74747c; overflow: hidden;
                text-overflow: ellipsis; white-space: nowrap; }
  @media (prefers-color-scheme: dark) {
    .chrome { background: #232428; border-bottom-color: rgba(128,128,128,.25); }
    .dot { background: #4a4a52; }
    .shot-wrap { background: #17181b; }
  }
  .frame { width: 100%; height: 420px; border: 0; display: block; background: #fff; }
  .expand { display: inline-block; margin: 10px 0 0; font-size: .85rem; color: #BA9E66;
            text-decoration: none; font-weight: 600; }
  .expand:hover { text-decoration: underline; }
  .card { border: 1px solid rgba(128,128,128,.25); border-radius: 12px; padding: 20px 24px; margin: 0 0 20px; }
  .card h2 { font-size: 1.05rem; margin: 0 0 14px; }
  .score { display: flex; align-items: baseline; gap: 12px; margin: 0 0 20px; }
  .score-num { font-size: 2.4rem; font-weight: 650; letter-spacing: -.02em; }
  .score-num span { font-size: 1rem; font-weight: 400; color: #6b7280; }
  .score-label { color: #6b7280; font-size: .9rem; }
  ul.issues { list-style: none; padding: 0; margin: 0; }
  ul.issues li { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid rgba(128,128,128,.18); }
  ul.issues li:first-child { border-top: 0; padding-top: 0; }
  ul.issues p { margin: 4px 0 0; color: #6b7280; font-size: .92rem; }
  .sev { flex-shrink: 0; font-size: .7rem; text-transform: uppercase; letter-spacing: .04em;
         padding: 3px 8px; border-radius: 999px; height: fit-content; font-weight: 600; }
  .sev-high { background: rgba(220,38,38,.12); color: #dc2626; }
  .sev-medium { background: rgba(217,119,6,.12); color: #d97706; }
  .sev-low { background: rgba(107,114,128,.15); color: #6b7280; }
  .cta { display: inline-block; margin-top: 8px; padding: 13px 26px; border-radius: 8px;
         background: #BA9E66; color: #16181d; text-decoration: none; font-weight: 600; }
  footer { margin-top: 44px; padding-top: 20px; border-top: 1px solid rgba(128,128,128,.18);
           font-size: .8rem; color: #9aa0aa; }
</style>
</head>
<body>
  <h1>A quick idea for ${name}'s website</h1>
  <p class="sub">We put together a concept and a short technical read on your current site — no strings attached.</p>

  ${beforeAfter}

  ${scoreBlock}
  ${issuesBlock}

  ${bookingUrl ? `<a class="cta" href="${esc(bookingUrl)}" target="_blank" rel="noreferrer noopener">Book a 15-minute call</a>` : ''}

  <footer>
    Put together by Hyperbole Digital. This is a private one-off page made for ${name} — it isn't listed or indexed anywhere.
  </footer>
</body>
</html>`
}

// Branded HTML email shell for messages a client's own staff receive
// (escalations, leads). These wear the CLIENT's brand — the widget colour and
// logo they already configured — because to the salesperson opening it, this
// is their own lead flow, not a third-party tool. A small Hyperbole footer
// rides along.
//
// Constraints that shape everything here:
//   - Email clients strip <style> blocks and ignore most modern CSS, so every
//     rule is inline and the layout is tables. No flexbox/grid, no external
//     CSS, no webfonts.
//   - Gmail clips messages over ~102KB, so this stays small.
//   - Every HTML email ships with a plain-text twin (see buildEmail below) for
//     clients that block HTML and for notification previews.

const HYPERBOLE_URL = 'https://hyperboledigital.com'
const DEFAULT_BRAND = '#6C5CE7' // matches the widget's built-in default

export interface EmailBrand {
  businessName: string
  color: string
  logoUrl?: string | null
  // Optional centred text in the header bar. Unset (the norm) = the header
  // shows just the client's mark — clients don't want "X Chat Assistant"
  // branding on their notifications; the eyebrow/subject already say what
  // the email is.
  label?: string
}

export interface EmailRow {
  label: string
  value: string
  // Rendered as a mailto:/tel: link when set — lets a salesperson act straight
  // from the email instead of copy-pasting an address.
  href?: string
}

export interface EmailContent {
  // Small uppercase line above the headline, e.g. "NEW LEAD".
  eyebrow: string
  headline: string
  intro?: string
  rows: EmailRow[]
  // The visitor's actual words, rendered as a quote block.
  quote?: { title: string; text: string }
  cta?: { label: string; url: string }
  footerNote?: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Preserves the visitor's line breaks in HTML without allowing any markup.
function escapeMultiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br />')
}

// A hex colour we're about to inline into a style attribute. Anything that
// isn't a plain hex triplet is rejected rather than escaped — this value comes
// from client-editable config, and a style context is not somewhere to gamble.
function safeColor(input: string | undefined | null): string {
  const value = (input ?? '').trim()
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value) ? value : DEFAULT_BRAND
}

// Only http(s) URLs get linked; anything else (javascript:, data:) is dropped.
function safeUrl(input: string | undefined | null): string | null {
  const value = (input ?? '').trim()
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value) || /^tel:/i.test(value)) {
    return escapeHtml(value)
  }
  return null
}

export function renderEmailHtml(brand: EmailBrand, content: EmailContent): string {
  const color = safeColor(brand.color)
  const logo = safeUrl(brand.logoUrl)
  const business = escapeHtml(brand.businessName)

  const rowsHtml = content.rows.map(row => {
    const href = safeUrl(row.href)
    const value = escapeHtml(row.value)
    return `
      <tr>
        <td style="padding:6px 0;font:500 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;width:110px;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:6px 0;font:400 15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">${href ? `<a href="${href}" style="color:${color};text-decoration:none;font-weight:500;">${value}</a>` : value}</td>
      </tr>`
  }).join('')

  const quoteHtml = content.quote ? `
    <tr><td style="padding-top:20px;">
      <p style="margin:0 0 8px;font:500 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(content.quote.title)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td style="border-left:3px solid ${color};background:#f9fafb;border-radius:0 6px 6px 0;padding:14px 16px;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#374151;">${escapeMultiline(content.quote.text)}</td>
      </tr></table>
    </td></tr>` : ''

  const ctaUrl = content.cta ? safeUrl(content.cta.url) : null
  const ctaHtml = content.cta && ctaUrl ? `
    <tr><td style="padding-top:24px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${color};border-radius:8px;">
          <a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">${escapeHtml(content.cta.label)}</a>
        </td>
      </tr></table>
    </td></tr>` : ''

  // Logo sits on the brand-coloured header bar, same as the widget, so a
  // light/white mark reads correctly — matching what the dashboard already
  // tells operators when they upload one. A client with no logo gets their
  // name in type instead, so the bar is never empty.
  const mark = logo
    ? `<img src="${logo}" alt="${business}" height="28" style="height:28px;max-width:130px;display:block;border:0;" />`
    : `<span style="font:600 17px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${business}</span>`

  // With a label: three cells — the client's mark left, the system label
  // centred, and an empty cell on the right of equal width so the label sits
  // centred in the bar rather than drifting toward the logo. Fixed 130px sides
  // keep that true in email clients, which don't support flexbox — and match
  // the logo's own max-width so a wide mark can't push the label off-centre.
  // Without a label (the default for escalation/lead notifications — the
  // client asked for just their mark, no "X Chat Assistant" text), the bar is
  // simply the mark on its own.
  const headerMark = brand.label
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td align="left" width="130" style="width:130px;vertical-align:middle;">${mark}</td>
        <td align="center" style="vertical-align:middle;font:600 16px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:.02em;">${escapeHtml(brand.label)}</td>
        <td width="130" style="width:130px;">&nbsp;</td>
      </tr></table>`
    : mark

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="color-scheme" content="light" />
<title>${escapeHtml(content.headline)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.intro ?? content.headline)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
    <tr><td style="background:${color};padding:18px 28px;">${headerMark}</td></tr>
    <tr><td style="padding:28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr><td>
          <p style="margin:0 0 6px;font:600 11px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${color};text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(content.eyebrow)}</p>
          <h1 style="margin:0;font:600 21px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">${escapeHtml(content.headline)}</h1>
          ${content.intro ? `<p style="margin:10px 0 0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#4b5563;">${escapeHtml(content.intro)}</p>` : ''}
        </td></tr>
        ${rowsHtml ? `<tr><td style="padding-top:20px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rowsHtml}</table></td></tr>` : ''}
        ${quoteHtml}
        ${ctaHtml}
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px 22px;border-top:1px solid #e5e7eb;">
      ${content.footerNote ? `<p style="margin:0 0 8px;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7280;">${escapeHtml(content.footerNote)}</p>` : ''}
      <p style="margin:0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#9ca3af;">
        Sent by your ${business} AI assistant &middot; <a href="${HYPERBOLE_URL}" style="color:#9ca3af;text-decoration:underline;">Powered by Hyperbole Digital</a>
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}

// The plain-text twin of the HTML above. Not a courtesy — it's what shows in
// notification previews and what HTML-blocking clients render, so it carries
// the same information in the same order.
export function renderEmailText(brand: EmailBrand, content: EmailContent): string {
  const lines: string[] = [content.headline, '']
  if (content.intro) lines.push(content.intro, '')
  for (const row of content.rows) lines.push(`${row.label}: ${row.value}`)
  if (content.quote) lines.push('', `${content.quote.title}:`, content.quote.text)
  if (content.cta) lines.push('', `${content.cta.label}: ${content.cta.url}`)
  if (content.footerNote) lines.push('', content.footerNote)
  lines.push('', `— Sent by your ${brand.businessName} AI assistant · Powered by Hyperbole Digital`)
  return lines.join('\n')
}

// One call site builds both representations, so they can never drift apart.
export function buildEmail(brand: EmailBrand, content: EmailContent): { html: string; text: string } {
  return { html: renderEmailHtml(brand, content), text: renderEmailText(brand, content) }
}

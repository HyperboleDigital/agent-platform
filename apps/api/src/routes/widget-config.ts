import { Router } from 'express'
import { isOriginAllowed } from '@agent-platform/shared'
import { getClientById } from '../lib/clients'
import { getLogo, logoUrl } from '../lib/widget-logo'

// Public, unauthenticated appearance config for the embeddable chat widget.
//
// The widget fetches this on load so a client's branding can be changed from
// the dashboard without them re-pasting the script tag into their own website.
//
// ⚠️ SECURITY: the only "credential" here is the client UUID, which is visible
// in the page source of every site that embeds the widget. Treat this endpoint
// as world-readable forever. The response is built field by field on purpose —
// never spread the client object or the widgetConfig blob, or a future field
// added upstream leaks the moment someone saves it. In particular agentConfig
// holds escalationEmail, slackWebhook, and knowledgeBaseIds, none of which may
// ever appear here.
export const widgetConfigRouter = Router()

widgetConfigRouter.get('/:clientId', async (req, res) => {
  const client = await getClientById(req.params.clientId)

  // 404 rather than an empty config: a typo'd UUID in a script tag should be
  // diagnosable from the network tab, not silently render default branding.
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' })

  const cfg = client.widgetConfig ?? {}

  // Domain lock. Refusing the config here is what makes an unauthorised embed
  // render *nothing* rather than falling back to default branding: widget.js
  // treats a 403 as "stop", unlike a network error.
  if (!isOriginAllowed(req.get('origin'), cfg.allowedDomains)) {
    return res.status(403).json({ error: 'This widget is not authorised for this domain.' })
  }

  // Long enough to absorb repeat page loads, short enough that a dashboard
  // edit reaches a live site promptly. Varies on Origin so a cache can never
  // hand an allowed origin's config to a blocked one.
  res.set('Vary', 'Origin')
  res.set('Cache-Control', 'public, max-age=60')

  res.json({
    // `name` is the widget's fallback for an unset title, so a client with no
    // config at all still shows their own business name rather than "Support".
    name: client.name,
    title: cfg.title,
    tagline: cfg.tagline,
    welcome: cfg.welcome,
    placeholder: cfg.placeholder,
    color: cfg.color,
    color2: cfg.color2,
    // An uploaded logo wins over a manually-entered URL, and is handed to the
    // widget as an absolute URL on our own origin — the storage path itself is
    // never exposed.
    logo: cfg.logoPath ? logoUrl(client.id) : cfg.logo,
    avatarEmoji: cfg.avatarEmoji,
    prompts: Array.isArray(cfg.prompts) ? cfg.prompts : undefined,
    chips: Array.isArray(cfg.chips)
      ? cfg.chips.slice(0, 4).map(c => ({ label: c?.label ?? '', message: c?.message ?? '' }))
      : undefined,
    contactFields: cfg.contactFields
      ? {
          company: !!cfg.contactFields.company,
          phone: !!cfg.contactFields.phone,
          divisionLabel: cfg.contactFields.divisionLabel,
          divisions: Array.isArray(cfg.contactFields.divisions)
            ? cfg.contactFields.divisions.map(d => String(d).trim()).filter(Boolean)
            : undefined,
          divisionMultiSelect: !!cfg.contactFields.divisionMultiSelect,
          splitName: !!cfg.contactFields.splitName,
          messageLabel: cfg.contactFields.messageLabel,
          messagePlaceholder: cfg.contactFields.messagePlaceholder,
          messageOptional: !!cfg.contactFields.messageOptional,
          phoneLabel: cfg.contactFields.phoneLabel,
          companyOptional: !!cfg.contactFields.companyOptional,
          phoneOptional: !!cfg.contactFields.phoneOptional
        }
      : undefined,
    // Per-client copy for the inline lead form ("demo" language is wrong for
    // e.g. a quote-driven client). Strings only, unset keys keep widget
    // defaults — see WidgetLeadFormCopy in packages/shared.
    leadForm: cfg.leadForm
      ? {
          title: cfg.leadForm.title,
          sub: cfg.leadForm.sub,
          btn: cfg.leadForm.btn,
          donePre: cfg.leadForm.donePre,
          donePost: cfg.leadForm.donePost,
          reason: cfg.leadForm.reason
        }
      : undefined
  })
})

// The uploaded logo bytes. Public for the same reason the config is: this is
// rendered on the client's own website by anonymous visitors. Served from our
// origin rather than a signed Supabase URL, which would expire while the widget
// is still live.
widgetConfigRouter.get('/:clientId/logo', async (req, res) => {
  const client = await getClientById(req.params.clientId)
  const storagePath = client?.widgetConfig?.logoPath
  if (!client || !client.active || !storagePath) return res.status(404).type('text/plain').send('Not found')

  try {
    const bytes = await getLogo(storagePath)
    res
      .set('Cache-Control', 'public, max-age=300')
      // Helmet defaults every response to CORP same-origin, which makes a
      // browser refuse to *render* this image anywhere but our own origin —
      // i.e. everywhere it's actually used (the dashboard preview on another
      // port, and every client site the widget is embedded on). CORS headers
      // don't cover it: an <img> load is a no-cors request, so CORP is the
      // only gate. This asset is public by design, hence the opt-out.
      .set('Cross-Origin-Resource-Policy', 'cross-origin')
      .type(client.widgetConfig?.logoContentType || 'image/png')
      .send(bytes)
  } catch {
    res.status(404).type('text/plain').send('Not found')
  }
})

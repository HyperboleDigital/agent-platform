interface SlackAlertParams {
  clientName: string
  from: string
  body: string
  reason: string
  // Set only when the visitor actually left an address — chat escalations
  // carry a session id, not an email (see lib/escalation.ts asEmail).
  visitorEmail?: string | null
  // Contact-form submission (someone asking to be contacted) vs. the bot
  // getting stuck mid-chat. Same alert, very different urgency to a human.
  isLead?: boolean
}

// Slack truncates hard in notifications and sidebars, so the quoted message is
// capped — the email carries the full text.
const MAX_QUOTE = 500

function truncate(text: string, max: number): string {
  const clean = (text ?? '').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

// Slack mrkdwn treats these as control characters; escape so a visitor's
// message can't inject formatting or fake a link.
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function sendSlackAlert(webhookUrl: string | undefined, params: SlackAlertParams): Promise<void> {
  const url = webhookUrl ?? process.env.SLACK_WEBHOOK_URL
  if (!url) { console.warn('No Slack webhook configured'); return }

  const isLead = !!params.isLead
  const icon = isLead ? ':wave:' : ':raising_hand:'
  const heading = isLead
    ? `${icon} New lead — ${params.clientName}`
    : `${icon} Needs a human — ${params.clientName}`
  const quoted = truncate(escapeMrkdwn(params.body), MAX_QUOTE)

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${heading}*` } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*From*\n${escapeMrkdwn(params.from)}` },
        { type: 'mrkdwn', text: `*Reason*\n${escapeMrkdwn(params.reason)}` }
      ]
    }
  ]

  if (quoted) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*What they said*\n>${quoted.replace(/\n/g, '\n>')}` } })
  }

  // Only offer the reply button when there's actually somewhere to reply to.
  if (params.visitorEmail) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '✉️  Reply by email', emoji: true },
        url: `mailto:${params.visitorEmail}`,
        style: 'primary'
      }]
    })
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: params.visitorEmail
        ? `${params.visitorEmail} · via your website assistant`
        : "No contact details left · via your website assistant"
    }]
  })

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `text` is the notification/preview line — without it Slack shows an
    // empty push notification for a blocks-only message.
    body: JSON.stringify({ text: heading, blocks })
  })
}

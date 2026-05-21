interface SlackAlertParams {
  clientName: string
  from: string
  body: string
  reason: string
}

export async function sendSlackAlert(webhookUrl: string | undefined, params: SlackAlertParams): Promise<void> {
  const url = webhookUrl ?? process.env.SLACK_WEBHOOK_URL
  if (!url) { console.warn('No Slack webhook configured'); return }
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `:warning: *Escalation — ${params.clientName}*`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `:warning: *Escalation — ${params.clientName}*\n*From:* ${params.from}\n*Reason:* ${params.reason}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Message:*\n>${params.body.slice(0, 300)}` } }
      ]
    })
  })
}

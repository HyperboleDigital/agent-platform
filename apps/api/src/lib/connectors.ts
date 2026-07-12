import { gmailConfigured, checkGmailStatus } from './gmail'
import type { AgentConfig } from '@agent-platform/shared'

export interface ConnectorStatus {
  gmail: {
    configured: boolean // is Gmail OAuth set up on this deployment at all
    connected: boolean
    status: 'ok' | 'error' | 'not_connected' | 'not_configured'
    email?: string
    connectedAt?: string
    error?: string
  }
  slack: { configured: boolean }
  calendly: { configured: boolean }
}

// Aggregates connector health for the dashboard's Connectors tab.
export async function getConnectorStatus(clientId: string, agentConfig: AgentConfig): Promise<ConnectorStatus> {
  const gmail = gmailConfigured()
    ? await checkGmailStatus(clientId)
    : { connected: false, status: 'not_configured' as const }

  return {
    gmail: { configured: gmailConfigured(), ...gmail },
    slack: { configured: !!(agentConfig?.slackWebhook || process.env.SLACK_WEBHOOK_URL) },
    calendly: { configured: !!agentConfig?.calendlyLink }
  }
}

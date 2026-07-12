import type { IncomingMessage, AgentResponse, AgentConfig } from '@agent-platform/shared'
import { searchDocs } from '../tools/knowledge-base'
import { bookCalendly } from '../tools/calendly'
import { logLead } from '../tools/crm'
import { notifyEscalation } from './escalation'
import { getClientById } from './clients'
import { runToolLoop } from './llm'
import type { ToolDef } from './llm'

// Provider-neutral tool definitions (converted per-provider in lib/llm).
const tools: ToolDef[] = [
  {
    name: 'search_knowledge_base',
    description: 'Search the client knowledge base for answers to FAQ questions. Always call this first for support questions.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query based on the user question' } },
      required: ['query']
    }
  },
  {
    name: 'get_booking_link',
    description: 'Get the scheduling link when a user wants to book a call, demo, or meeting.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' }
      },
      required: []
    }
  },
  {
    name: 'capture_lead',
    description: 'Save lead info when a user is a new prospect expressing interest. If you do not yet have their email, still call this with the intent and summary — the chat will show a contact form to collect their details.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        intent: { type: 'string', description: 'What they are looking for' },
        summary: { type: 'string', description: 'Brief conversation summary' }
      },
      required: ['intent', 'summary']
    }
  },
  {
    name: 'escalate_to_human',
    description: 'Flag conversation for human review — use for upset users, billing disputes, or low confidence.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why this needs human attention' } },
      required: ['reason']
    }
  }
]

function buildSystemPrompt(config: Partial<AgentConfig>, clientName: string): string {
  return `You are a helpful support agent for ${clientName}.

Rules:
- Keep responses to 1-3 sentences. Be direct — answer the question first, context second.
- Sound human. Use contractions. Say "we", not "the company".
- Never say "As an AI". Never invent information not in the knowledge base.
- Always end with a clear next step (question, booking link, or offer to connect).
- If you don't know, say so simply and offer to connect them with the team.
- Never list more than 3 options. Recommend the most likely answer.

${config?.systemPromptExtra ?? ''}`
}

export async function runAgent(message: IncomingMessage): Promise<AgentResponse> {
  const client = await getClientById(message.clientId)
  if (!client) throw new Error(`Client ${message.clientId} not found`)

  const systemPrompt = buildSystemPrompt(client.agentConfig ?? {}, client.name)

  let escalate = false
  let captureLead = false
  let needContact = false
  let intent: AgentResponse['intent'] = 'unknown'

  // Tool dispatch — shared across providers. Closes over the flags above so we
  // can derive intent/action after the loop regardless of which model ran it.
  const execute = async (name: string, input: any): Promise<string> => {
    if (name === 'search_knowledge_base') {
      intent = 'faq'
      return searchDocs(input.query, message.clientId)
    }
    if (name === 'get_booking_link') {
      intent = 'booking'
      return bookCalendly(client.agentConfig?.calendlyLink, input.name, input.email)
    }
    if (name === 'capture_lead') {
      intent = 'lead'
      if (input.email) {
        await logLead({ clientId: message.clientId, name: input.name, email: input.email, intent: input.intent, summary: input.summary })
        captureLead = true
        return 'Lead captured.'
      }
      needContact = true
      return 'No email on file yet. A contact form will be shown to collect their details.'
    }
    if (name === 'escalate_to_human') {
      intent = 'escalate'
      escalate = true
      await notifyEscalation(client, { from: message.from, message: message.body, reason: input.reason, channel: 'chat' })
      return 'Escalation sent.'
    }
    return `Unknown tool: ${name}`
  }

  const { reply } = await runToolLoop({ system: systemPrompt, userMessage: message.body, tools, execute })

  const confidence = escalate ? 0.2 : intent === 'unknown' ? 0.4 : 0.9

  return {
    intent, reply,
    action: escalate ? 'escalate'
      : needContact ? 'show_contact_form'
      : captureLead ? 'capture_lead'
      : 'send_reply',
    escalate, captureLead, confidence
  }
}

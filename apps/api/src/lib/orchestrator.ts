import Anthropic from '@anthropic-ai/sdk'
import type { IncomingMessage, AgentResponse, AgentConfig } from '@agent-platform/shared'
import { searchDocs } from '../tools/knowledge-base'
import { bookCalendly } from '../tools/calendly'
import { logLead } from '../tools/crm'
import { sendSlackAlert } from '../tools/slack'
import { getClientById } from './clients'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const tools: Anthropic.Tool[] = [
  {
    name: 'search_knowledge_base',
    description: 'Search the client knowledge base for answers to FAQ questions. Always call this first for support questions.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query based on the user question' } },
      required: ['query']
    }
  },
  {
    name: 'get_booking_link',
    description: 'Get the scheduling link when a user wants to book a call, demo, or meeting.',
    input_schema: {
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
    description: 'Save lead info when a user is a new prospect expressing interest.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        intent: { type: 'string', description: 'What they are looking for' },
        summary: { type: 'string', description: 'Brief conversation summary' }
      },
      required: ['email', 'intent', 'summary']
    }
  },
  {
    name: 'escalate_to_human',
    description: 'Flag conversation for human review — use for upset users, billing disputes, or low confidence.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why this needs human attention' } },
      required: ['reason']
    }
  }
]

function buildSystemPrompt(config: Partial<AgentConfig>, clientName: string): string {
  return `You are a helpful AI support agent for ${clientName}.

Your job:
1. Answer support questions using the knowledge base (always search first)
2. Help users book calls or demos when they express interest
3. Capture lead info for new prospects
4. Escalate to a human when the question is complex, the user is upset, or you are not confident

Be friendly, concise, and on-brand. Never invent information not found in the knowledge base.
${config?.systemPromptExtra ?? ''}`
}

export async function runAgent(message: IncomingMessage): Promise<AgentResponse> {
  const client = await getClientById(message.clientId)
  if (!client) throw new Error(`Client ${message.clientId} not found`)

    const systemPrompt = buildSystemPrompt(client.agentConfig ?? {}, client.name)
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: message.body }
  ]

  let reply = ''
  let escalate = false
  let captureLead = false
  let intent: AgentResponse['intent'] = 'unknown'

  // Agentic loop — Claude calls tools until stop_reason === 'end_turn'
  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages
    })

    for (const block of response.content) {
      if (block.type === 'text') reply = block.text
    }

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        let result = ''

        if (block.name === 'search_knowledge_base') {
          const i = block.input as { query: string }
          result = await searchDocs(i.query, message.clientId)
          intent = 'faq'
        }
        if (block.name === 'get_booking_link') {
          const i = block.input as { name?: string; email?: string }
          result = await bookCalendly(client.agentConfig.calendlyLink, i.name, i.email)
          intent = 'booking'
        }
        if (block.name === 'capture_lead') {
          const i = block.input as { name?: string; email: string; intent: string; summary: string }
          await logLead({ clientId: message.clientId, ...i })
          result = 'Lead captured.'
          captureLead = true
          intent = 'lead'
        }
        if (block.name === 'escalate_to_human') {
          const i = block.input as { reason: string }
          await sendSlackAlert(client.agentConfig.slackWebhook, {
            clientName: client.name, from: message.from, body: message.body, reason: i.reason
          })
          result = 'Escalation sent.'
          escalate = true
          intent = 'escalate'
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }

      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
    }
  }

  const confidence = escalate ? 0.2 : intent === 'unknown' ? 0.4 : 0.9

  return {
    intent, reply,
    action: escalate ? 'escalate' : captureLead ? 'capture_lead' : 'send_reply',
    escalate, captureLead, confidence
  }
}

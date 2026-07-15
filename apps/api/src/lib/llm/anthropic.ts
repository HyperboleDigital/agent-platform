import Anthropic from '@anthropic-ai/sdk'
import type { ToolLoopOptions, ToolLoopResult } from './types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const tools: Anthropic.Tool[] = opts.tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema
  }))

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.userMessage }]
  let reply = ''
  const maxTurns = opts.maxTurns ?? 6

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: opts.system,
      tools,
      messages
    })

    for (const block of response.content) {
      if (block.type === 'text') reply = block.text
    }

    if (response.stop_reason !== 'tool_use') break

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await opts.execute(block.name, block.input)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
    }
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
  }

  return { reply }
}

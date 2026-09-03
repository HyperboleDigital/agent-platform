import OpenAI from 'openai'
import type { ToolLoopOptions, ToolLoopResult } from './types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = opts.tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    ...(opts.history ?? []).map(t => ({ role: t.role, content: t.content } as OpenAI.Chat.Completions.ChatCompletionMessageParam)),
    { role: 'user', content: opts.userMessage }
  ]
  let reply = ''
  let inputTokens = 0
  let outputTokens = 0
  const maxTurns = opts.maxTurns ?? 6

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      tools,
      tool_choice: 'auto',
      messages
    })
    inputTokens += response.usage?.prompt_tokens ?? 0
    outputTokens += response.usage?.completion_tokens ?? 0

    const msg = response.choices[0]?.message
    if (!msg) break
    if (msg.content) reply = msg.content

    if (!msg.tool_calls?.length) break

    messages.push(msg) // assistant turn carrying the tool_calls
    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue
      let input: any = {}
      try { input = JSON.parse(call.function.arguments || '{}') } catch { /* leave {} */ }
      const result = await opts.execute(call.function.name, input)
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  return { reply, usage: { model: MODEL, inputTokens, outputTokens } }
}

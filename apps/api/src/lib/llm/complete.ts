import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

// Small single-turn completion helper for one-off jobs (audit summaries,
// visibility judging) that don't need the orchestrator's tool loop. Uses
// cheap models by default — these run per-client, potentially on a schedule,
// so cost matters more than for a live chat reply.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CHEAP_OPENAI_MODEL = process.env.OPENAI_CHEAP_MODEL ?? 'gpt-4o-mini'
const CHEAP_ANTHROPIC_MODEL = process.env.ANTHROPIC_CHEAP_MODEL ?? 'claude-haiku-4-5-20251001'

// Strong models for quality-critical generation (blog content). Separate env
// overrides from the cheap tier — repricing quality vs. cost is config, not code.
const STRONG_OPENAI_MODEL = process.env.OPENAI_CONTENT_MODEL ?? 'gpt-4o'
const STRONG_ANTHROPIC_MODEL = process.env.ANTHROPIC_CONTENT_MODEL ?? 'claude-sonnet-5'

export type CompleteProvider = 'openai' | 'anthropic'

export interface CompleteOptions {
  system?: string
  provider?: CompleteProvider
  maxTokens?: number
  // 'cheap' (default) for judging/summarizing; 'strong' for client-facing prose.
  tier?: 'cheap' | 'strong'
}

export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
  const provider = opts.provider ?? (process.env.LLM_PROVIDER === 'openai' ? 'openai' : 'anthropic')
  const maxTokens = opts.maxTokens ?? 800
  const strong = opts.tier === 'strong'

  if (provider === 'openai') {
    const res = await openai.chat.completions.create({
      model: strong ? STRONG_OPENAI_MODEL : CHEAP_OPENAI_MODEL,
      max_tokens: maxTokens,
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user' as const, content: prompt }
      ]
    })
    return res.choices[0]?.message?.content ?? ''
  }

  const res = await anthropic.messages.create({
    model: strong ? STRONG_ANTHROPIC_MODEL : CHEAP_ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: prompt }]
  })
  const block = res.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text : ''
}

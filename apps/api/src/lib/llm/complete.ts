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

// ── Vision ───────────────────────────────────────────────────────────────────
// Anthropic-only, unlike complete() above: this exists for prospect concept
// generation, which needs to *look* at design references and a screenshot of
// the prospect's current site. Routing it through the provider switch would
// mean maintaining an OpenAI vision path that nothing calls.

export type VisionMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface VisionImage {
  buffer: Buffer
  mediaType: VisionMediaType
  // Shown to the model immediately before the image, so it knows what it's
  // looking at and how to treat it — a reference to imitate reads very
  // differently from the prospect's current site.
  caption: string
}

export interface CompleteWithImagesOptions {
  system?: string
  maxTokens?: number
}

// Streams rather than awaiting a single response: a full HTML page runs to
// several thousand tokens, and non-streaming requests at this maxTokens hit
// the SDK's HTTP timeout.
export async function completeWithImages(
  prompt: string,
  images: VisionImage[],
  opts: CompleteWithImagesOptions = {}
): Promise<string> {
  const content: Anthropic.MessageParam['content'] = []
  for (const image of images) {
    content.push({ type: 'text', text: image.caption })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.buffer.toString('base64') }
    })
  }
  content.push({ type: 'text', text: prompt })

  const stream = anthropic.messages.stream({
    model: STRONG_ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content }]
  })

  const res = await stream.finalMessage()
  const block = res.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text : ''
}

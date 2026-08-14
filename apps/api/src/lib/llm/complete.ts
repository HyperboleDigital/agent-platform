import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { TokenUsage } from './pricing'

// Small single-turn completion helper for one-off jobs (audit summaries,
// visibility judging) that don't need the orchestrator's tool loop. Uses
// cheap models by default — these run per-client, potentially on a schedule,
// so cost matters more than for a live chat reply.
// Exported so image-gen.ts can reuse the same client instance rather than
// instantiating a second one (same API key, same underlying HTTP agent).
//
// Lazy, because the OpenAI SDK throws on construction when no key is set, and
// eager construction at module load meant importing anything in this directory
// hard-required OPENAI_API_KEY — which broke Gemini-only deployments at boot,
// not at the point of use. Now a deployment without an OpenAI key runs fine
// until something actually asks OpenAI for something.
let openaiClient: OpenAI | null = null
export function openai(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return openaiClient
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CHEAP_OPENAI_MODEL = process.env.OPENAI_CHEAP_MODEL ?? 'gpt-4o-mini'
const CHEAP_ANTHROPIC_MODEL = process.env.ANTHROPIC_CHEAP_MODEL ?? 'claude-haiku-4-5-20251001'

// Strong models for quality-critical generation (blog content). Separate env
// overrides from the cheap tier — repricing quality vs. cost is config, not code.
const STRONG_OPENAI_MODEL = process.env.OPENAI_CONTENT_MODEL ?? 'gpt-4o'
const STRONG_ANTHROPIC_MODEL = process.env.ANTHROPIC_CONTENT_MODEL ?? 'claude-sonnet-5'

export type CompleteProvider = 'openai' | 'anthropic'

// Reported per call so a caller that cares (the generation wizard, which shows
// the operator what a run cost) can price it, without changing the string
// return every other caller already depends on.
export interface UsageReport extends TokenUsage {
  model: string
}
export type UsageSink = (usage: UsageReport) => void

export interface CompleteOptions {
  system?: string
  provider?: CompleteProvider
  maxTokens?: number
  // 'cheap' (default) for judging/summarizing; 'strong' for client-facing prose.
  tier?: 'cheap' | 'strong'
  onUsage?: UsageSink
}

export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
  const provider = opts.provider ?? (process.env.LLM_PROVIDER === 'openai' ? 'openai' : 'anthropic')
  const maxTokens = opts.maxTokens ?? 800
  const strong = opts.tier === 'strong'

  if (provider === 'openai') {
    const res = await openai().chat.completions.create({
      model: strong ? STRONG_OPENAI_MODEL : CHEAP_OPENAI_MODEL,
      max_tokens: maxTokens,
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user' as const, content: prompt }
      ]
    })
    opts.onUsage?.({
      model: strong ? STRONG_OPENAI_MODEL : CHEAP_OPENAI_MODEL,
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    })
    return res.choices[0]?.message?.content ?? ''
  }

  const anthropicModel = strong ? STRONG_ANTHROPIC_MODEL : CHEAP_ANTHROPIC_MODEL
  const res = await anthropic.messages.create({
    model: anthropicModel,
    max_tokens: maxTokens,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: prompt }]
  })
  opts.onUsage?.({
    model: anthropicModel,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
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
  onUsage?: UsageSink
  // 'strong' (default) for the actual HTML write-up; 'cheap' for a design
  // analysis pass that only needs to describe what it sees, not produce a
  // finished page — keeps that pass cheap enough to run every generation.
  tier?: 'cheap' | 'strong'
  // Why the model stopped. 'max_tokens' means the text below is CUT OFF
  // mid-output, not finished — for a generated HTML page that's a half-built
  // document that still renders (browsers auto-close tags), so nothing
  // downstream can detect it by inspecting the markup. Callers that can't
  // tolerate a partial answer must check this.
  onStopReason?: (reason: string | null) => void
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

  const visionModel = opts.tier === 'cheap' ? CHEAP_ANTHROPIC_MODEL : STRONG_ANTHROPIC_MODEL
  const stream = anthropic.messages.stream({
    model: visionModel,
    max_tokens: opts.maxTokens ?? 16000,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content }]
  })

  // finalMessage() carries the same usage a non-streaming call would, so
  // streaming (needed for the HTML pass's token budget) costs no visibility.
  const res = await stream.finalMessage()
  opts.onUsage?.({
    model: visionModel,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  })
  opts.onStopReason?.(res.stop_reason ?? null)
  const block = res.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text : ''
}

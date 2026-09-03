// What a generation run actually cost, in millionths of a USD.
//
// Integer micros rather than dollars-as-float: provider prices are quoted per
// million tokens and to fractions of a cent, so cents would round most of a
// run away and floats accumulate drift across the several calls a run makes.
//
// Every figure below was read off the provider's own pricing page on
// 2026-08-10, not recalled:
//   Claude — https://platform.claude.com/docs/en/about-claude/pricing
//   Gemini — https://ai.google.dev/gemini-api/docs/pricing
// Prices move. Each is env-overridable so a change doesn't need a deploy, and
// unknown models fall back to 0 with a warning rather than inventing a number
// that would quietly under-report spend.

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

const MICROS_PER_USD = 1_000_000

function envUsdPerMTok(key: string, fallback: number): number {
  const raw = process.env[key]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

// Claude Sonnet 5 is on introductory pricing ($2/$10 per MTok) only through
// 2026-08-31; from 2026-09-01 it becomes $3/$15. Encoded as a date switch
// rather than a single hardcoded pair, because the cheaper number would
// silently under-report every run from September onward.
const SONNET_5_STANDARD_FROM = Date.parse('2026-09-01T00:00:00Z')

function sonnet5Prices(now: number): { input: number; output: number } {
  return now >= SONNET_5_STANDARD_FROM
    ? { input: envUsdPerMTok('PRICE_SONNET_INPUT', 3), output: envUsdPerMTok('PRICE_SONNET_OUTPUT', 15) }
    : { input: envUsdPerMTok('PRICE_SONNET_INPUT', 2), output: envUsdPerMTok('PRICE_SONNET_OUTPUT', 10) }
}

// USD per million tokens.
function claudePrices(model: string, now: number): { input: number; output: number } | null {
  const m = model.toLowerCase()
  if (m.includes('sonnet-5') || m === 'claude-sonnet-5') return sonnet5Prices(now)
  if (m.includes('haiku-4-5') || m.includes('haiku-4.5')) {
    return { input: envUsdPerMTok('PRICE_HAIKU_INPUT', 1), output: envUsdPerMTok('PRICE_HAIKU_OUTPUT', 5) }
  }
  if (m.includes('opus-5')) return { input: 5, output: 25 }
  if (m.includes('sonnet')) return sonnet5Prices(now)   // unknown Sonnet revision: price as current Sonnet
  if (m.includes('haiku')) return { input: 1, output: 5 }
  return null
}

export function claudeCostMicros(model: string, usage: TokenUsage, now = Date.now()): number {
  const prices = claudePrices(model, now)
  if (!prices) {
    console.warn(`[pricing] no price for Claude model "${model}" — run cost will under-report`)
    return 0
  }
  const usd = (usage.inputTokens / 1_000_000) * prices.input + (usage.outputTokens / 1_000_000) * prices.output
  return Math.round(usd * MICROS_PER_USD)
}

// USD per generated image, which Gemini prices by model AND output resolution
// — a 4K image is roughly double a 1K one, so resolution has to be part of the
// key rather than assumed.
const GEMINI_IMAGE_USD: Record<string, Record<string, number>> = {
  'gemini-3-pro-image':      { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  'gemini-3.1-flash-image':  { '512': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 },
}

export function geminiImageCostMicros(model: string, size: string): number {
  const usd = GEMINI_IMAGE_USD[model]?.[size]
  if (usd === undefined) {
    console.warn(`[pricing] no price for Gemini image model "${model}" at size "${size}" — run cost will under-report`)
    return 0
  }
  return Math.round(usd * MICROS_PER_USD)
}

// gpt-image-1 is the fallback provider and is priced per image by size; only
// the two sizes this codebase actually requests are listed.
const OPENAI_IMAGE_USD: Record<string, number> = {
  '1024x1536': 0.02,
  '1536x1024': 0.02,
}

export function openaiImageCostMicros(size: string): number {
  const usd = OPENAI_IMAGE_USD[size]
  if (usd === undefined) return 0
  return Math.round(usd * MICROS_PER_USD)
}

// USD per million tokens for the OpenAI text models this codebase can run
// chat on (LLM_PROVIDER=openai). Same env-override convention as Claude.
function openaiPrices(model: string): { input: number; output: number } | null {
  const m = model.toLowerCase()
  if (m.includes('gpt-4o-mini')) {
    return { input: envUsdPerMTok('PRICE_GPT4O_MINI_INPUT', 0.15), output: envUsdPerMTok('PRICE_GPT4O_MINI_OUTPUT', 0.6) }
  }
  if (m.includes('gpt-4o')) {
    return { input: envUsdPerMTok('PRICE_GPT4O_INPUT', 2.5), output: envUsdPerMTok('PRICE_GPT4O_OUTPUT', 10) }
  }
  return null
}

// Cost of a text completion on whichever provider the model name identifies —
// the single entry point for chat cost accounting, so callers don't need to
// know which provider ran the loop. Unknown models log + return 0, same as
// claudeCostMicros.
export function llmCostMicros(model: string, usage: TokenUsage, now = Date.now()): number {
  const m = model.toLowerCase()
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')) {
    const prices = openaiPrices(model)
    if (!prices) {
      console.warn(`[pricing] no price for OpenAI model "${model}" — cost will under-report`)
      return 0
    }
    const usd = (usage.inputTokens / 1_000_000) * prices.input + (usage.outputTokens / 1_000_000) * prices.output
    return Math.round(usd * MICROS_PER_USD)
  }
  return claudeCostMicros(model, usage, now)
}

export function formatMicros(micros: number): string {
  return `$${(micros / MICROS_PER_USD).toFixed(3)}`
}

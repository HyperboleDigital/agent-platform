import type { ToolLoopOptions, ToolLoopResult } from './types'
import { runToolLoop as anthropicLoop } from './anthropic'
import { runToolLoop as openaiLoop } from './openai'

export type { ToolDef, ToolExecutor, ToolLoopOptions, ToolLoopResult } from './types'

export type LlmProvider = 'anthropic' | 'openai'

export function activeProvider(): LlmProvider {
  return process.env.LLM_PROVIDER === 'openai' ? 'openai' : 'anthropic'
}

// Runs the agentic tool loop on the configured provider. Pass `provider` to
// override per-call (e.g. cheap model for chat, Anthropic for heavier work).
export async function runToolLoop(
  opts: ToolLoopOptions,
  provider: LlmProvider = activeProvider()
): Promise<ToolLoopResult> {
  return provider === 'openai' ? openaiLoop(opts) : anthropicLoop(opts)
}

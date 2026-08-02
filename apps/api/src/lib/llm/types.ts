// Provider-neutral tool + tool-loop interface. Each provider (Anthropic,
// OpenAI) implements runToolLoop against its own wire format; callers work only
// with these shapes so the orchestrator is provider-agnostic.

export interface ToolDef {
  name: string
  description: string
  // JSON Schema object: { type: 'object', properties: {...}, required: [...] }
  parameters: Record<string, unknown>
}

// Runs one tool for the model and returns the string result fed back to it.
export type ToolExecutor = (name: string, input: any) => Promise<string>

// One prior exchange in the same chat session. Server-reconstructed only —
// see lib/chat-memory.ts for why this never comes from the client.
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolLoopOptions {
  system: string
  userMessage: string
  tools: ToolDef[]
  execute: ToolExecutor
  maxTurns?: number
  /** Earlier turns of this conversation, oldest first. */
  history?: ChatTurn[]
}

export interface ToolLoopResult {
  reply: string
}

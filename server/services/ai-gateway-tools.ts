/**
 * The tool half of `callAi`'s tool loop — part of the `ai-gateway.ts` family (the split of
 * `callAi`, wave3 follow-up to 4.3): the tool list in the provider's wire format, the
 * assistant turn replayed to the model, and running the calls the model asked for.
 *
 * Running a tool never fails the call: a missing tool or one that throws becomes an
 * `{ error }` result that is replayed to the model. An `onToolCall` hook that throws DOES
 * end the call (as `provider_error`, in the loop's catch) — pinned as is.
 */
import { parseToolArguments } from './ai-response-parse'
import type { AiCallInput, AiToolDefinition, ExecutedToolCall } from './ai-gateway-types'

type ToolCall = { id: string; function: { name: string; arguments: string } }

/** `tools` of a chat-completions request (OpenAI-compatible function calling). */
export function formatToolDefinitions(tools: AiToolDefinition[]) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

/** The model's tool-call turn as replayed in step 2: no text, every call with string arguments. */
export function assistantToolCallMessage(toolCalls: ToolCall[]) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments),
      },
    })),
  }
}

/**
 * Run each call in order: `onToolCall` "calling", the tool, `onToolCall` "done", then the
 * result appended to `messages` as a `tool` turn and to `executed`. The query shown to the
 * visitor is the tool's `query`, else `keyword`, else `chủ đề: <type>`.
 */
export async function runToolCalls(toolCalls: ToolCall[], toolDefs: AiToolDefinition[], input: AiCallInput,
  messages: unknown[], executed: ExecutedToolCall[]): Promise<void> {
  for (const tc of toolCalls) {
    const fn = toolDefs.find(t => t.name === tc.function?.name)
    const args = parseToolArguments(tc.function?.arguments)
    let qStr = ''
    if (args && typeof args === 'object') {
      qStr = String(args.query || args.keyword || (args.type ? `chủ đề: ${args.type}` : ''))
    }

    if (input.onToolCall) {
      await input.onToolCall({
        name: tc.function?.name,
        query: qStr || undefined,
        status: 'calling',
      })
    }

    let toolResult: unknown = null
    if (fn) {
      try {
        toolResult = await fn.execute(args)
      } catch (err: unknown) {
        toolResult = { error: err instanceof Error ? err.message : 'Tool execution error' }
      }
    } else {
      toolResult = { error: `Tool ${tc.function?.name} not found` }
    }

    const itemCount = Array.isArray(toolResult) ? toolResult.length : (toolResult ? 1 : 0)
    executed.push({
      name: tc.function?.name,
      query: qStr || undefined,
      count: itemCount,
      data: toolResult,
    })

    if (input.onToolCall) {
      await input.onToolCall({
        name: tc.function?.name,
        query: qStr || undefined,
        status: 'done',
        count: itemCount,
        result: toolResult,
      })
    }

    messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
    })
  }
}

import { cleanAiContent } from './ai-text-cleaner'

/**
 * Phân tích phản hồi của provider: lấy câu trả lời + số token (theo từng loại
 * provider) và đọc lệnh gọi công cụ từ tin nhắn của model.
 *
 * Toàn hàm thuần, chuyển nguyên văn khỏi `ai-gateway.ts` (không đổi hành vi) để
 * tệp đó chỉ còn việc điều phối cuộc gọi. `ai-gateway.ts` vẫn re-export
 * `parseToolArguments`/`extractToolCallsFromMessage` cho nơi đã import từ đó.
 */

// ─── Provider response parsing ──────────────────────────────────────────

export interface UsageParseResult {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  answerText: string
}

/**
 * Parse usage tokens from a provider response body (spec R10.2, design.md D8).
 *
 * Strategy map isolates provider-specific logic:
 * - Google Gemini: `usageMetadata.{promptTokenCount, candidatesTokenCount}`
 * - OpenAI/DeepSeek: `usage.{prompt_tokens, completion_tokens}`
 * - Anthropic: `usage.{input_tokens, output_tokens}`
 */
export function parseProviderResponse(provider: string, payload: unknown, policy: string): UsageParseResult {
  const answerText = extractAnswer(policy, payload)
  const usage = extractUsage(provider, payload)

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    answerText,
  }
}

function extractAnswer(policy: string, payload: unknown): string {
  return cleanAiContent(rawExtractAnswer(policy, payload))
}

function rawExtractAnswer(policy: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  if (policy === 'anthropic') {
    const blocks = (payload as { content?: unknown }).content
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((block): block is { type?: unknown; text?: unknown } => Boolean(block) && typeof block === 'object')
      .filter(block => block.type === undefined || block.type === 'text')
      .map(block => (typeof block.text === 'string' ? block.text : ''))
      .join('')
  }

  // OpenAI-compatible (includes Google Gemini via compatible endpoint, DeepSeek)
  const choice = (payload as { choices?: unknown }).choices
  if (Array.isArray(choice) && choice[0] && typeof choice[0] === 'object') {
    const message = (choice[0] as { message?: unknown }).message
    if (message && typeof message === 'object') {
      const content = (message as { content?: unknown }).content
      return typeof content === 'string' ? content : ''
    }
  }

  // Google Gemini native API shape
  const candidates = (payload as { candidates?: unknown }).candidates
  if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === 'object') {
    const content = (candidates[0] as { content?: unknown }).content
    if (content && typeof content === 'object') {
      const parts = (content as { parts?: unknown }).parts
      if (Array.isArray(parts) && parts[0] && typeof parts[0] === 'object') {
        const text = (parts[0] as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
    }
  }

  return ''
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  let str = String(raw || '').trim()
  str = str.replace(/<\|"\|>/g, '"').replace(/<\|/g, '').replace(/\|>/g, '')
  try {
    return JSON.parse(str) as Record<string, unknown>
  } catch {
    try {
      const fixed = str.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
      return JSON.parse(fixed) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}

export function extractToolCallsFromMessage(
  msg: Record<string, unknown> | undefined,
  availableTools?: Array<{ name: string }>,
): Array<{ id: string; function: { name: string; arguments: string } }> {
  if (!msg) return []
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    return msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>
  }
  const content = typeof msg.content === 'string' ? msg.content : ''
  if (!content) return []
  const list: Array<{ id: string; function: { name: string; arguments: string } }> = []

  // Pattern A: <|tool_call>call:funcName{...}
  const patA = /<\|tool_call>call:(\w+)([{][\s\S]*?[}])(?:<\|?\/?tool_call\|?>)?/g
  let mA: RegExpExecArray | null
  while ((mA = patA.exec(content)) !== null) {
    list.push({
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      function: {
        name: mA[1] ?? '',
        arguments: mA[2] ?? '',
      },
    })
  }
  // Pattern B: Pythonic function calls: funcName(param="value")
  if (list.length === 0 && Array.isArray(availableTools) && availableTools.length > 0) {
    for (const t of availableTools) {
      const regex = new RegExp(t.name + '\\s*\\(([^)]*)\\)', 'g')
      let mB: RegExpExecArray | null
      while ((mB = regex.exec(content)) !== null) {
        const rawArgs = (mB[1] ?? '').trim()
        const args: Record<string, unknown> = {}
        const argRegex = /(\w+)\s*=\s*["']([^"']*)["']/g
        let am: RegExpExecArray | null
        while ((am = argRegex.exec(rawArgs)) !== null) {
          args[am[1] ?? ''] = am[2] ?? ''
        }
        if (Object.keys(args).length > 0) {
          list.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            function: {
              name: t.name,
              arguments: JSON.stringify(args),
            },
          })
        }
      }
    }
  }

  return list
}

function extractUsage(provider: string, payload: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } {
  if (!payload || typeof payload !== 'object') return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  if (provider === 'google') {
    const meta = (payload as { usageMetadata?: unknown }).usageMetadata
    if (meta && typeof meta === 'object') {
      const m = meta as { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown }
      const promptTokens = Number(m.promptTokenCount ?? 0)
      const completionTokens = Number(m.candidatesTokenCount ?? 0)
      return { promptTokens, completionTokens, totalTokens: Number(m.totalTokenCount ?? promptTokens + completionTokens) }
    }
  }

  // Anthropic
  if (provider === 'anthropic') {
    const usage = (payload as { usage?: unknown }).usage
    if (usage && typeof usage === 'object') {
      const u = usage as { input_tokens?: unknown; output_tokens?: unknown }
      const promptTokens = Number(u.input_tokens ?? 0)
      const completionTokens = Number(u.output_tokens ?? 0)
      return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
    }
  }

  // OpenAI-compatible (OpenAI, DeepSeek)
  const usage = (payload as { usage?: unknown }).usage
  if (usage && typeof usage === 'object') {
    const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
    const promptTokens = Number(u.prompt_tokens ?? 0)
    const completionTokens = Number(u.completion_tokens ?? 0)
    return { promptTokens, completionTokens, totalTokens: Number(u.total_tokens ?? promptTokens + completionTokens) }
  }

  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

// ─── Gateway entry point ───────────────────────────────────────────────

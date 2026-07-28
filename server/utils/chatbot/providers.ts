/**
 * Per-provider request shapes.
 *
 * `provider_policy` used to be a free-text label that nothing read: the chat
 * path always spoke the OpenAI `/chat/completions` dialect. Claude's Messages
 * API differs in three ways that cannot be papered over with a base URL — the
 * credential travels in `x-api-key` rather than `Authorization`, the system
 * prompt is a top-level field rather than a message with `role: 'system'`, and
 * the answer arrives under `content[].text` rather than `choices[].message`.
 *
 * So the policy now selects a real adapter. Everything else about the outbound
 * call (host allowlist, DNS pinning, size and time budgets) stays in outbound.ts
 * and is unchanged by the choice made here.
 */

export const CHATBOT_PROVIDER_POLICIES = ['openai-compatible', 'anthropic'] as const
export type ChatbotProviderPolicy = typeof CHATBOT_PROVIDER_POLICIES[number]

/**
 * What the admin form fills in when the operator picks a policy. These are
 * suggestions written into an editable field, not a hidden allowlist: a
 * deployment behind a gateway keeps its own base URL and hostname.
 */
export const CHATBOT_PROVIDER_PRESETS: Readonly<Record<ChatbotProviderPolicy, {
  label: string
  baseUrl: string
  host: string
  model: string
  hint: string
}>> = Object.freeze({
  'openai-compatible': {
    label: 'OpenAI (và các API tương thích OpenAI)',
    baseUrl: 'https://api.openai.com/v1',
    host: 'api.openai.com',
    model: 'gpt-4o-mini',
    hint: 'Dùng cho OpenAI hoặc bất kỳ dịch vụ nói cùng giao thức /chat/completions (Azure OpenAI, vLLM, OpenRouter…).',
  },
  anthropic: {
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    host: 'api.anthropic.com',
    model: 'claude-opus-5',
    hint: 'Dùng Messages API của Anthropic. Khóa gửi qua x-api-key, không phải Authorization.',
  },
})

/** The Messages API version header. Anthropic requires it on every request. */
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_ANSWER_TOKENS = 1200

/** An unknown/legacy value keeps the historical OpenAI behaviour. */
export function resolveProviderPolicy(value: unknown): ChatbotProviderPolicy {
  return value === 'anthropic' ? 'anthropic' : 'openai-compatible'
}

/**
 * Join a provider path onto a stored base URL without duplicating the version
 * segment. Operators write `https://api.anthropic.com` and
 * `https://api.anthropic.com/v1` interchangeably; both must reach `/v1/messages`.
 */
function withPath(baseUrl: string, versioned: string, bare: string): string {
  const base = baseUrl.trim().replace(/\/+$/u, '')
  return base.endsWith('/v1') ? `${base}${bare}` : `${base}${versioned}`
}

export type ProviderCall = {
  url: string
  headers: Record<string, string>
  body?: string
}

export type ChatCallInput = {
  policy: unknown
  baseUrl: string
  model: string
  secret: string
  systemPrompt: string
  /** Already-rendered user turns, oldest first. */
  history: Array<{ role: string; content: string }>
}

/**
 * Build the chat completion request for the selected policy.
 *
 * The system prompt is passed separately rather than as history[0] so the
 * Anthropic branch can place it in its own field; the OpenAI branch re-inserts
 * it as a `role: 'system'` message, which is what it was before.
 */
export function buildProviderChatCall(input: ChatCallInput): ProviderCall {
  const policy = resolveProviderPolicy(input.policy)

  if (policy === 'anthropic') {
    return {
      url: withPath(input.baseUrl, '/v1/messages', '/messages'),
      headers: {
        'x-api-key': input.secret,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: MAX_ANSWER_TOKENS,
        system: input.systemPrompt,
        messages: input.history,
      }),
    }
  }

  return {
    url: withPath(input.baseUrl, '/v1/chat/completions', '/chat/completions'),
    headers: {
      Authorization: `Bearer ${input.secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: 'system', content: input.systemPrompt }, ...input.history],
      stream: false,
      max_tokens: MAX_ANSWER_TOKENS,
    }),
  }
}

/**
 * The cheapest authenticated GET that proves the credential works, used by the
 * "test connection" button. Both providers expose `/v1/models`.
 */
export function buildProviderProbeCall(input: { policy: unknown; baseUrl: string; secret: string }): ProviderCall {
  const policy = resolveProviderPolicy(input.policy)
  const url = withPath(input.baseUrl, '/v1/models', '/models')

  return policy === 'anthropic'
    ? { url, headers: { 'x-api-key': input.secret, 'anthropic-version': ANTHROPIC_VERSION, Accept: 'application/json' } }
    : { url, headers: { Authorization: `Bearer ${input.secret}`, Accept: 'application/json' } }
}

/** Pull the answer text out of a provider response body. */
export function extractProviderAnswer(policy: unknown, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''

  if (resolveProviderPolicy(policy) === 'anthropic') {
    const blocks = (payload as { content?: unknown }).content
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((block): block is { type?: unknown; text?: unknown } => Boolean(block) && typeof block === 'object')
      .filter(block => block.type === undefined || block.type === 'text')
      .map(block => (typeof block.text === 'string' ? block.text : ''))
      .join('')
  }

  const choice = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choice) || !choice[0] || typeof choice[0] !== 'object') return ''
  const message = (choice[0] as { message?: unknown }).message
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

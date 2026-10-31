/**
 * Harness: the two public chat handlers (`/api/public/chatbot`, `/api/chat`) driven with the
 * REAL moderation path — `moderation-worker` → `moderation-regex` runtime, real rules cache,
 * real built-in dictionaries, real review-queue writer — with only the edges faked: the
 * database (rules come from `state.rules`, review-queue rows land in `state.queue`), the AI
 * gateway (never reached by the instant check; "safe" for the comment path), and the chat
 * plumbing around moderation (`answerChat` records the history it is given; rate limit always
 * passes).
 *
 * The tests that mock `moderation-worker` itself prove the handlers call it; this proves what
 * the real moderation decides through them (wave3 4.3c follow-up: the history turns moved from
 * one `matchInstantRule` call per turn to one batched pass — same decisions, same rows).
 *
 * Import this module FIRST: it registers the mocks, then imports the handlers.
 */
import { mock } from 'node:test'
import { aiModerationQueue, aiModerationRules } from '../server/db/schema.ts'

type Row = Record<string, unknown>

export const state = {
  rules: [] as Row[],
  queue: [] as Row[],
  /** The history each `answerChat` call received, in order. */
  answered: [] as unknown[][],
  persisted: [] as string[],
}

/** A drizzle builder that is awaitable at `.where()` and chainable (`.orderBy().limit()`). */
const rows = (list: Row[]) => Object.assign(Promise.resolve(list), { orderBy: () => ({ limit: async () => list }), limit: async () => list })

const fakeDb = {
  select: () => ({ from: (table: unknown) => ({ where: () => rows(table === aiModerationRules ? state.rules : []) }) }),
  insert: (table: unknown) => ({ values: async (value: Row) => { if (table === aiModerationQueue) state.queue.push(value); return [{ insertId: 1, affectedRows: 1 }] } }),
  execute: async () => [{ affectedRows: 1 }, undefined],
  update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
}

mock.module(new URL('../server/utils/db.ts', import.meta.url).href, { namedExports: { getDb: () => fakeDb, getPool: () => null } })
// Only `checkAndModerateContent` (comment path) reaches the AI; it judges everything safe.
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url).href, {
  namedExports: { callAi: async () => ({ ok: true, text: '{"verdict":"safe"}' }) },
})
mock.module('h3', {
  namedExports: {
    setHeader: (event: { headers: Record<string, string> }, name: string, value: string) => { event.headers[name] = value },
    getRequestHeader: (event: { reqHeaders: Record<string, string> }, name: string) => event.reqHeaders[name],
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})
mock.module(new URL('../server/services/chatbot-settings.ts', import.meta.url).href, { namedExports: { getChatbotSettings: async () => ({}) } })
mock.module(new URL('../server/utils/chatbot/chat.ts', import.meta.url).href, {
  namedExports: {
    answerChat: async (_event: unknown, _settings: unknown, messages: unknown) => {
      state.answered.push(messages as unknown[])
      return { answer: 'Trả lời.', kind: 'curated', sources: [] }
    },
  },
})
mock.module(new URL('../server/utils/chatbot/chat-policy.ts', import.meta.url).href, {
  namedExports: {
    CHAT_LIMITS: Object.freeze({ maxBodyBytes: 64_000, maxMessageChars: 10_000, maxOutputChars: 8_000 }),
    validateChatRequestBody: () => {},
    chargeChatRateLimit: async () => null,
    CHAT_RATE_LIMITED_MESSAGE: 'Bạn đã gửi quá nhiều yêu cầu.',
  },
})
mock.module(new URL('../server/utils/chatbot/session-token.ts', import.meta.url).href, { namedExports: { verifySessionToken: () => 'session-abc' } })
mock.module(new URL('../server/utils/chatbot/session-db.ts', import.meta.url).href, {
  namedExports: { persistChatTurn: async (turn: { userText: string }) => { state.persisted.push(turn.userText) } },
})
mock.module(new URL('../server/utils/client-ip.ts', import.meta.url).href, { namedExports: { getClientIp: () => '203.0.113.9' } })
mock.module(new URL('../server/utils/runtime-config.ts', import.meta.url).href, { namedExports: { analyticsHmacSecret: () => 'secret' } })

type Event = { body: unknown, headers: Record<string, string>, reqHeaders: Record<string, string>, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body

export type ChatHandler = (event: Event) => Promise<string>
export const publicHandler = (await import('../server/api/public/chatbot/index.post.ts')).default as unknown as ChatHandler
export const legacyHandler = (await import('../server/api/chat.post.ts')).default as unknown as ChatHandler
export const HANDLERS = [['/api/public/chatbot', publicHandler], ['/api/chat', legacyHandler]] as const

export const worker = await import('../server/services/moderation-worker.ts')
export const moderationRegex = await import('../server/services/moderation-regex.ts')

let nextRuleId = 1
/** A rule row as `ai_moderation_rules` stores it. */
export const rule = (pattern: string, ruleType: 'regex' | 'keyword' = 'regex', extra: Row = {}): Row => ({
  id: nextRuleId++, pattern, ruleType, category: `cat-${pattern.slice(0, 12)}`, severity: 'high', action: 'auto_hide', isEnabled: true, ...extra,
})

/** Fresh rules, empty records, cleared slow-rule/compile state (the real rules cache is invalidated). */
export function reset(rules: Row[] = []): void {
  state.rules = rules
  state.queue = []
  state.answered = []
  state.persisted = []
  worker.invalidateModerationRulesCache()
  moderationRegex.setModerationRegexTimingForTests(null)
}

export const send = (handler: ChatHandler, messages: unknown[]) =>
  handler({ body: { messages }, headers: {}, reqHeaders: { 'x-chat-session': 'token' }, context: {} })

/** The `chatbot.kind` of a non-streamed reply. */
export const kindOf = (reply: string): string | undefined => reply.split('\n')
  .filter(line => line.startsWith('data: {'))
  .map(line => JSON.parse(line.slice(6)) as { chatbot?: { kind?: string } })
  .map(frame => frame.chatbot?.kind)
  .find(Boolean)

/** The user turns of the last history `answerChat` received. */
export const answeredUserTexts = (): string[] => ((state.answered.at(-1) ?? []) as Array<{ role?: string, content?: string }>)
  .filter(turn => turn.role === 'user').map(turn => String(turn.content))

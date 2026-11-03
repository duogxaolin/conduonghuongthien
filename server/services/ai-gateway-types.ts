/**
 * The input and result types of `callAi` — part of the `ai-gateway.ts` family
 * (wave3-long-term 4.3, D-SPLIT). Moved verbatim; callers import them from the barrel
 * `./ai-gateway`.
 *
 * The last section holds the types the parts of `callAi` hand each other (the split of the
 * function itself): the barrel does not re-export them.
 */
import type { Database } from '../utils/db'
import type { ProviderRequest, ResolveProviderHost } from '../utils/chatbot/outbound'
import type { ProviderCall } from '../utils/chatbot/providers'

// ─── Types ──────────────────────────────────────────────────────────────

export interface AiToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

export interface AiCallInput {
  /** The user's prompt text. */
  prompt: string
  /** Override the system prompt from the service config (used by chatbot to inject grounded references). */
  systemPrompt?: string
  /** Template variables to substitute into `system_prompt` `{{key}}` placeholders. */
  variables?: Record<string, string>
  /** The admin user ID triggering the call (for usage logging), or null. */
  userId?: number | null
  db?: Database
  /** Chat history: prior user turns, oldest first. */
  history?: Array<{ role: string; content: string }>
  /** Optional callback for real-time token streaming */
  onChunk?: (chunk: string) => void | Promise<void>
  /** Optional callback for real-time tool execution events */
  onToolCall?: (event: { name: string; query?: string; status: 'calling' | 'done'; count?: number; result?: unknown }) => void | Promise<void>
  /** Optional tool calling / function calling definitions */
  tools?: AiToolDefinition[]
  /**
   * Chỗ tiêm cho test: thay `https.request` và bộ phân giải DNS bên dưới
   * `safeProviderRequest`/`safeProviderStream`. Mọi kiểm tra (chính sách URL, DNS→IP
   * công khai, ghim IP, chặn chuyển hướng, hạn giờ, trần byte) vẫn chạy thật — chỉ
   * socket là giả. Mã production không truyền trường này.
   */
  transport?: AiTransportOverrides
}

export interface AiTransportOverrides {
  request?: ProviderRequest
  resolveHost?: ResolveProviderHost
}
export interface AiCallResult {
  ok: boolean
  text?: string
  error?: string
  errorMessage?: string
  /** Usage metadata (filled on success for callers that need it). */
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  costUsd?: number
  costVnd?: number
  /** Tools executed during this call */
  toolCallsExecuted?: Array<{ name: string; query?: string; count?: number; data?: unknown }>
}

// ─── Between the parts of `callAi` (not re-exported) ─────────────────────

/** One tool run by the tool loop, as `AiCallResult.toolCallsExecuted` lists it. */
export type ExecutedToolCall = NonNullable<AiCallResult['toolCallsExecuted']>[number]

/**
 * What the prelude of `callAi` hands the paths once every refusal has passed: the
 * request as built, and the names the token rules and the epilogue need.
 *
 * The request's headers carry the decrypted key, and this object travels whole: into
 * `runToolLoop`, `runStreamedAnswer` and `runBufferedAnswer` (which hand
 * `providerCall` to the senders) and into `recordAiCall` (which reads only `provider` and
 * `model`). Only `ai-gateway-send.ts` puts the key on the wire; every other holder must
 * not log, return or throw it — pinned by `tests/ai-gateway-callai-behavior.test.ts`
 * (results, log lines, usage rows, chunks, request bodies; the error that escapes when the
 * pricing read fails is the one test on the epilogue's throwing branch).
 */
export interface PreparedAiCall {
  /** `ai_service_configs.provider` — the name the token rules test (`delify`). */
  provider: string
  model: string
  /** The wire format (`policyForProvider`). */
  policy: string
  providerCall: ProviderCall
}

/**
 * A path that failed (an error status, nothing readable, a connection or address refused at
 * send time). Its call writes ONE usage row marking the failure (`recordAiFailure`,
 * `ai-gateway-record.ts`) — until 2026-10-31 it wrote none.
 */
export interface AiPathFailure {
  ok: false
  error: 'provider_error' | 'parse_error'
}

/** A path that produced an answer: the billed token counts and, for the tool loop, the tools run. */
export interface AiPathAnswer {
  ok: true
  answerText: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  toolCallsExecuted?: ExecutedToolCall[]
}

export type AiPathOutcome = AiPathFailure | AiPathAnswer

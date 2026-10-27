/**
 * The input and result types of `callAi` — part of the `ai-gateway.ts` family
 * (wave3-long-term 4.3, D-SPLIT). Moved verbatim; callers import them from the barrel
 * `./ai-gateway`.
 */
import type { Database } from '../utils/db'
import type { ProviderRequest, ResolveProviderHost } from '../utils/chatbot/outbound'

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

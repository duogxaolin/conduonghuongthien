/**
 * The three ways `callAi` sends its request — part of the `ai-gateway.ts` family (the split
 * of `callAi`, wave3 follow-up to 4.3). The ONE file of the gateway that calls the senders
 * of `outbound.ts`; the request it is handed carries the decrypted key in its headers.
 *
 * Every request goes through `safeProviderRequest` (buffered) or `safeProviderStream`
 * (SSE) — no path uses a bare `fetch`. `allowedHosts` is derived from the same URL, so on
 * its own it proves nothing: the guards that matter are `checkProviderBaseUrl` in the
 * prelude (the write-time policy re-checked at call time) and, inside outbound, DNS→public
 * IP with the checked IP pinned to the socket, https/443 only, no redirects, a deadline and
 * a byte cap. What differs per path is only the deadline and the cap:
 *   - one buffered step of the tool loop: 300 s, 1 MiB;
 *   - a stream: outbound's stream defaults (300 s in all, 240 s of silence, 4 MiB);
 *   - the one buffered request of the no-tool path: 35 s, 256 KiB.
 */
import {
  safeProviderRequest, safeProviderStream,
  type SafeProviderResponse, type SafeProviderStreamResponse,
} from '../utils/chatbot/outbound'
import type { ProviderCall } from '../utils/chatbot/providers'
import type { AiTransportOverrides } from './ai-gateway-types'

// Giới hạn đường ra của vòng gọi công cụ. Bước không stream của vòng công cụ
// trước đây dùng `fetch` trần — không hạn giờ, không trần dung lượng. Hạn giờ bằng
// hạn tổng của luồng SSE (outbound.ts): model suy luận có thể mất tới ~200 s trước
// khi trả gì, và quyết định đã chốt là đợi chứ không bỏ (sse-heartbeat.ts).
const TOOL_STEP_TIMEOUT_MS = 300_000
const TOOL_STEP_MAX_RESPONSE_BYTES = 1024 * 1024
// The no-tool buffered request: a caller that does not stream waits for the whole answer.
const PLAIN_TIMEOUT_MS = 35_000
const PLAIN_MAX_RESPONSE_BYTES = 262_144

export interface ProviderSender {
  /** One buffered step of the tool loop. */
  postToolStep: (body: string) => Promise<SafeProviderResponse>
  /** A streamed request. `body` of the answer is `null` exactly when the status is not 2xx. */
  postStream: (body: string) => Promise<SafeProviderStreamResponse>
  /** The no-tool buffered request, with the body exactly as the provider builder made it. */
  postPlain: () => Promise<SafeProviderResponse>
}

/**
 * The senders for one call. `transport` is the test seam of `AiCallInput` (a fake socket and
 * resolver under outbound — every check above them still runs); production passes nothing.
 */
export function providerSender(providerCall: ProviderCall, transport: AiTransportOverrides | undefined): ProviderSender {
  const url = new URL(providerCall.url)
  const allowedHosts = [url.hostname]
  return {
    postToolStep: (body: string) => safeProviderRequest({
      url: providerCall.url,
      allowedHosts,
      method: 'POST',
      headers: providerCall.headers,
      body,
      timeoutMs: TOOL_STEP_TIMEOUT_MS,
      maxResponseBytes: TOOL_STEP_MAX_RESPONSE_BYTES,
      resolveHost: transport?.resolveHost,
      request: transport?.request,
    }),
    postStream: (body: string) => safeProviderStream({
      url: providerCall.url,
      allowedHosts,
      method: 'POST',
      headers: providerCall.headers,
      body,
      resolveHost: transport?.resolveHost,
      request: transport?.request,
    }),
    postPlain: () => safeProviderRequest({
      url: providerCall.url,
      allowedHosts,
      method: 'POST',
      headers: providerCall.headers,
      body: providerCall.body,
      timeoutMs: PLAIN_TIMEOUT_MS,
      maxResponseBytes: PLAIN_MAX_RESPONSE_BYTES,
      resolveHost: transport?.resolveHost,
      request: transport?.request,
    }),
  }
}

export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

export function responseText(response: SafeProviderResponse): string {
  return Buffer.from(response.body).toString('utf8')
}

/**
 * A buffered answer as JSON, bytes after the last `}` dropped (a proxy's trailer). Throws
 * on anything else — the paths turn that into `provider_error`. Trimming first (the no-tool
 * path does, the tool loop does not) is the caller's choice: it decides whether a leading
 * BOM is tolerated.
 */
export function parseUpToLastBrace(text: string): unknown {
  const last = text.lastIndexOf('}')
  return JSON.parse(last !== -1 ? text.slice(0, last + 1) : text)
}

/**
 * The one way to Delify Router's usage API (`/api/usage/key`, `/api/usage/key/receipts`)
 * — used by `ai/delify/sync`, `ai/delify/status` and the budget guard (`ai-budget.ts`).
 *
 * The three used to call a bare `fetch` on a hard-coded `https://router.delify.vn/…`:
 * no provider URL policy, no DNS → public-IP check, redirects followed, no byte cap,
 * and the API key went to that host whatever base URL it had been entered for. Now:
 *   - the host is the one in the delify row's `base_url` (where the gateway already
 *     sends this key), checked by `checkProviderBaseUrl` — https, port 443, a public
 *     name, no IP literal, no `localhost`/`.internal`/…; a refused URL is never resolved;
 *   - the request goes through `safeProviderRequest` (outbound.ts): DNS → public IP
 *     pinned to the socket, no redirect, a deadline and a byte cap.
 *
 * The key is sent as the `key` query value because that is the only form the usage API
 * is known to take (Delify's own usage page calls `/api/usage/key?key=…`); a header
 * would be better but is unverified. So the URL is never logged, never put in an
 * error, and the logger's name-based redaction is not relied on: a failure logs the
 * outbound error code and the path only.
 */
import { checkProviderBaseUrl } from './provider-url'
import { ChatbotOutboundError, safeProviderRequest, type ProviderRequest, type ResolveProviderHost } from '../chatbot/outbound'
import { logWarn } from '../logger'

export const DELIFY_USAGE_TIMEOUT_MS = 10_000
/** Receipts with 100 history rows and the model list are a few tens of KB. */
export const DELIFY_USAGE_MAX_RESPONSE_BYTES = 1024 * 1024

export type DelifyUsagePath = '/api/usage/key' | '/api/usage/key/receipts'
export type DelifyUsageFailure = 'provider_url_rejected' | 'unreachable' | 'bad_response'

const UNREACHABLE = 'Không thể kết nối tới Delify Router API.'
const BAD_RESPONSE = 'Delify Router API trả dữ liệu không hợp lệ.'

/** `message` is a fixed Vietnamese sentence safe to show; it never carries the key or URL. */
export class DelifyUsageError extends Error {
  readonly reason: DelifyUsageFailure
  constructor(reason: DelifyUsageFailure, message: string) {
    super(message)
    this.name = 'DelifyUsageError'
    this.reason = reason
  }
}

export interface DelifyUsageRequest {
  /** `ai_providers.base_url` of the delify row; the usage API is on the same host. */
  baseUrl: string | null
  secret: string
  path: DelifyUsagePath
  /** Other query values; `key` is always the secret. */
  params?: Readonly<Record<string, string>>
  timeoutMs?: number
  maxResponseBytes?: number
  /** Seams below outbound.ts, as `callAi`'s `AiTransportOverrides` (tests). */
  resolveHost?: ResolveProviderHost
  request?: ProviderRequest
}

/** `{ status, data }`: `data` is the parsed JSON of a 2xx answer, `null` for any other status. */
export async function fetchDelifyUsage(input: DelifyUsageRequest): Promise<{ status: number, data: unknown }> {
  const target = checkProviderBaseUrl(input.baseUrl)
  if (!target.ok) throw new DelifyUsageError('provider_url_rejected', target.message)

  let response
  try {
    response = await safeProviderRequest({
      url: `https://${target.hostname}${input.path}`,
      allowedHosts: [target.hostname],
      method: 'GET',
      headers: { accept: 'application/json' },
      query: { ...input.params, key: input.secret },
      timeoutMs: input.timeoutMs ?? DELIFY_USAGE_TIMEOUT_MS,
      maxResponseBytes: input.maxResponseBytes ?? DELIFY_USAGE_MAX_RESPONSE_BYTES,
      resolveHost: input.resolveHost,
      request: input.request,
    })
  } catch (error) {
    const code = error instanceof ChatbotOutboundError ? error.code : 'UPSTREAM_FAILURE'
    logWarn({ event: 'ai_panel.delify_usage_failed', path: input.path, code })
    throw new DelifyUsageError('unreachable', UNREACHABLE)
  }

  if (response.status < 200 || response.status >= 300) return { status: response.status, data: null }
  try {
    return { status: response.status, data: JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown }
  } catch {
    logWarn({ event: 'ai_panel.delify_usage_failed', path: input.path, code: 'BAD_JSON' })
    throw new DelifyUsageError('bad_response', BAD_RESPONSE)
  }
}

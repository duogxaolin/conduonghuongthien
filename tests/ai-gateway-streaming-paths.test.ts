import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import test, { mock } from 'node:test'
import type { AiTransportOverrides } from '../server/services/ai-gateway'
import type { ProviderRequest, ResolveProviderHost } from '../server/utils/chatbot/outbound'

/**
 * `callAi` đọc luồng SSE của provider ở bốn nơi: bước 1 của vòng gọi công cụ,
 * bước 2 (trả lời cuối sau công cụ), nhánh "model trả lời thẳng", và đường stream
 * không có công cụ. Bốn bản sao gần giống nhau — và khác nhau ở đúng những chi
 * tiết dễ bị làm mất khi gộp (cách cộng token, đường dự phòng khi rỗng).
 *
 * Bộ test này chạy `callAi` thật với socket giả (`https.request` + DNS giả tiêm qua
 * `input.transport`, bên dưới `outbound.ts`) trả về luồng SSE bị cắt ở vị trí
 * tuỳ ý, rồi kiểm văn bản người đọc nhận được và số token được ghi. Nó viết
 * **trước** khi gộp vòng lặp, để việc gộp được đo bằng hành vi chứ không bằng việc
 * đọc mã.
 */

const usageLog: Array<Record<string, unknown>> = []
mock.module('../server/utils/ai-budget', { namedExports: { checkBudget: async () => ({ allowed: true }) } })
mock.module('../server/utils/ai-usage', { namedExports: { logAiUsage: async (_db: unknown, entry: Record<string, unknown>) => { usageLog.push(entry) } } })
mock.module('../server/utils/ai/crypto', { namedExports: { decryptAiSecret: () => 'sk-test-key' } })

const { callAi } = await import('../server/services/ai-gateway')
const { aiServiceConfigs, aiProviders, aiModelPricing } = await import('../server/db/schema')

// ─── Fakes ───────────────────────────────────────────────────────────────────

const PROVIDER_ROW = {
  provider: 'delify',
  baseUrl: 'https://api.provider.example/v1',
  apiKeyCiphertext: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 1, apiKeyKeyId: 'k', apiKeyLastFour: 'abcd',
}

let serial = 0
function fakeDb(serviceKey: string) {
  const rowsFor = (table: unknown): unknown[] => {
    if (table === aiServiceConfigs) return [{ serviceKey, provider: 'delify', model: 'test-model', isActive: true, systemPrompt: '', maxTokens: 1024 }]
    if (table === aiProviders) return [PROVIDER_ROW]
    if (table === aiModelPricing) return []
    return []
  }
  return {
    select: () => ({
      from: (table: unknown) => {
        const chain: { where: () => typeof chain, limit: () => Promise<unknown[]> } = {
          where: () => chain,
          limit: () => Promise.resolve(rowsFor(table)),
        }
        return chain
      },
    }),
  } as never
}

/** One SSE event. */
const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const content = (text: string) => event({ choices: [{ delta: { content: text } }] })
const usage = (prompt: number, completion: number, estimated = false) => event({ usage: { prompt_tokens: prompt, completion_tokens: completion, estimated } })
const toolDelta = (delta: Record<string, unknown>) => event({ choices: [{ delta: { tool_calls: [delta] } }] })
const DONE = 'data: [DONE]\n\n'

/** A streaming Response whose body is cut every `size` bytes — events straddle chunks. */
function sseResponse(text: string, size = 7): Response {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/**
 * The provider seen by `callAi`. Every request now goes through `outbound.ts`
 * (`safeProviderStream` / `safeProviderRequest`), so the fake sits one level below
 * it: `https.request` and the DNS resolver. The URL policy, the DNS→public-IP check,
 * the pinned lookup, the redirect/size/time guards all run for real; only the socket
 * is fake, replaying the `Response` fixtures below.
 */
type Recorded = { body: Record<string, unknown>, options: RequestOptions }
let activeTransport: AiTransportOverrides | undefined
const PUBLIC_DNS: ResolveProviderHost = async () => [{ address: '93.184.216.34', family: 4 }]

function fakeIncoming(response: Response): IncomingMessage {
  const body = response.body ? Readable.fromWeb(response.body as never) : Readable.from([])
  return Object.assign(body, { statusCode: response.status, headers: Object.fromEntries(response.headers) }) as unknown as IncomingMessage
}

/** An `Error` in `responses` is the socket failing that request (`error` on the request: a reset, a refused connection). */
async function withProvider<T>(responses: Array<Response | (() => Response) | Error>, run: (requests: Recorded[]) => Promise<T>, resolveHost = PUBLIC_DNS): Promise<T> {
  const requests: Recorded[] = []
  let next = 0
  const request: ProviderRequest = (options, onResponse) => {
    const written: string[] = []
    const req = Object.assign(new EventEmitter(), {
      write: (chunk: unknown) => { written.push(String(chunk)) },
      destroy: () => {},
      end: () => {
        requests.push({ body: JSON.parse(written.join('') || '{}'), options })
        const response = responses[next++]
        if (!response) { queueMicrotask(() => req.emit('error', new Error(`unexpected request #${next}`))); return }
        if (response instanceof Error) { queueMicrotask(() => req.emit('error', response)); return }
        const incoming = fakeIncoming(typeof response === 'function' ? response() : response)
        queueMicrotask(() => onResponse(incoming))
      },
    })
    return req as never
  }
  activeTransport = { request, resolveHost }
  try { return await run(requests) } finally { activeTransport = undefined }
}

const knowledgeTool = (calls: Array<Record<string, unknown>>) => ({
  name: 'search_c11_knowledge',
  description: 'tra cứu',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async (args: Record<string, unknown>) => { calls.push(args); return [{ id: 1, question: 'Q', answer: 'A' }, { id: 2, question: 'Q2', answer: 'A2' }] },
})

async function run(options: { tools?: ReturnType<typeof knowledgeTool>[], stream?: boolean }) {
  const serviceKey = `svc-${++serial}`
  const chunks: string[] = []
  const toolEvents: Array<Record<string, unknown>> = []
  const result = await callAi(serviceKey, {
    prompt: 'xin chào',
    db: fakeDb(serviceKey),
    tools: options.tools,
    ...(options.stream === false ? {} : { onChunk: (chunk: string) => { chunks.push(chunk) } }),
    onToolCall: (evt: Record<string, unknown>) => { toolEvents.push(evt) },
    transport: activeTransport,
  } as never)
  return { result, chunks, toolEvents, relayed: chunks.join('') }
}

// ─── No tools: the pure streaming path ───────────────────────────────────────

test('no tools: the visitor gets the streamed text and the billed tokens are the provider\'s', async () => {
  await withProvider([sseResponse(content('Xin chào ') + content('anh/chị.') + usage(2100, 30) + DONE)], async (requests) => {
    const { result, relayed } = await run({})
    assert.equal(relayed, 'Xin chào anh/chị.')
    assert.ok(result.ok && result.text === 'Xin chào anh/chị.')
    // delify reports 2000 prompt tokens of its own overhead.
    assert.equal(result.ok && result.promptTokens, 100)
    assert.equal(result.ok && result.completionTokens, 30)
    assert.equal(requests.length, 1)
    assert.equal(requests[0]!.body.stream, true)
    // The stream goes through outbound.ts, not a bare fetch: TLS name = provider
    // host, port 443, no shared agent, and a lookup pinned to the checked address.
    const options = requests[0]!.options
    assert.equal(options.servername, 'api.provider.example')
    assert.equal(options.port, 443)
    assert.equal(options.agent, false)
    const pinned = await new Promise<unknown[]>((resolve) => {
      ;(options.lookup as unknown as (host: string, opts: object, cb: (...args: unknown[]) => void) => void)('api.provider.example', { all: true }, (...args) => resolve(args))
    })
    assert.deepEqual(pinned, [null, [{ address: '93.184.216.34', family: 4 }]])
  })
})

test('no tools: a real usage event replaces an earlier estimate, never the other way round', async () => {
  await withProvider([sseResponse(content('Đáp án') + usage(50, 5, true) + usage(2300, 20) + usage(70, 9, true) + DONE)], async () => {
    const { result } = await run({})
    assert.equal(result.ok && result.promptTokens, 300)
    assert.equal(result.ok && result.completionTokens, 20)
  })
})

test('no tools: with no usage at all the counts are estimated from the text, not zero', async () => {
  await withProvider([sseResponse(content('Một câu trả lời ngắn.') + DONE)], async () => {
    const { result } = await run({})
    assert.ok(result.ok && result.promptTokens > 0 && result.completionTokens > 0)
  })
})

test('no tools: reasoning spans never reach the visitor, even when split across chunks', async () => {
  await withProvider([sseResponse(content('<thi') + content('nk>bí mật nội bộ</thi') + content('nk>Đáp án công khai.') + DONE, 5)], async () => {
    const { result, relayed } = await run({})
    assert.equal(relayed, 'Đáp án công khai.')
    assert.ok(result.ok && !result.text.includes('bí mật'))
  })
})

test('no tools: an answer that is only reasoning is an empty response, not a blank success', async () => {
  await withProvider([sseResponse(content('<think>chỉ có suy nghĩ</think>') + DONE)], async () => {
    const { result } = await run({})
    assert.equal(result.ok, false)
  })
})

test('a stream that ends without a trailing newline still delivers its last event', async () => {
  // The last `data:` line of some providers carries no `\n`. It used to be dropped,
  // which silently cut the end of the answer off.
  await withProvider([sseResponse(content('Phần đầu. ') + content('Phần cuối.').trimEnd())], async () => {
    const { result, relayed } = await run({})
    assert.equal(relayed, 'Phần đầu. Phần cuối.')
    assert.ok(result.ok && result.text === 'Phần đầu. Phần cuối.')
  })
})

// ─── Tools: step 1 decides, step 2 answers ───────────────────────────────────

const step1WithToolCall = () => sseResponse(
  content('Để tôi tra cứu. ')
  + toolDelta({ index: 0, id: 'call_abc', type: 'function', function: { name: 'search_c11_knowledge', arguments: '' } })
  + toolDelta({ index: 0, function: { arguments: '{"que' } })
  + toolDelta({ index: 0, function: { arguments: 'ry":"vay vốn"}' } })
  + usage(2100, 12) + DONE,
  9,
)

test('tools: tool-call fragments are assembled across chunks and the tool runs once', async () => {
  const calls: Array<Record<string, unknown>> = []
  const step2 = () => sseResponse(content('Theo quy định, ') + content('anh/chị được vay.') + usage(2300, 20) + DONE, 11)
  await withProvider([step1WithToolCall(), step2()], async (requests) => {
    const { result, relayed, toolEvents } = await run({ tools: [knowledgeTool(calls)] })
    assert.deepEqual(calls, [{ query: 'vay vốn' }])
    assert.equal(requests.length, 2)

    // Step 1 asks for a decision with tools on and streams; step 2 drops the tools.
    assert.ok(Array.isArray(requests[0]!.body.tools))
    assert.equal(requests[0]!.body.tool_choice, 'auto')
    assert.equal(requests[0]!.body.stream, true)
    assert.equal(requests[1]!.body.tools, undefined)
    assert.equal(requests[1]!.body.stream, true)
    const messages = requests[1]!.body.messages as Array<Record<string, unknown>>
    assert.ok(messages.some(m => m.role === 'assistant' && Array.isArray(m.tool_calls)), 'the tool call is replayed to the model')
    assert.ok(messages.some(m => m.role === 'tool' && m.tool_call_id === 'call_abc'), 'and so is its result')

    // The visitor sees the step-1 preamble and then the final answer.
    assert.equal(relayed, 'Để tôi tra cứu. Theo quy định, anh/chị được vay.')
    assert.ok(result.ok && result.text === relayed)
    assert.deepEqual(toolEvents.map(e => [e.name, e.status, e.count]), [['search_c11_knowledge', 'calling', undefined], ['search_c11_knowledge', 'done', 2]])
    // Tokens add across both steps, each minus delify's 2000.
    assert.equal(result.ok && result.promptTokens, 100 + 300)
    assert.equal(result.ok && result.completionTokens, 12 + 20)
    assert.equal(result.ok && result.toolCallsExecuted?.length, 1)
  })
})

test('tools: a failing final answer is a provider error, not a half answer', async () => {
  const calls: Array<Record<string, unknown>> = []
  await withProvider([step1WithToolCall(), new Response('boom', { status: 502 })], async () => {
    const { result } = await run({ tools: [knowledgeTool(calls)] })
    assert.equal(result.ok, false)
    assert.equal(!result.ok && result.error, 'provider_error')
  })
})

test('tools: a final answer that is only reasoning streams nothing to the visitor', async () => {
  // What the call RETURNS in this case is a separate question; what the visitor is
  // shown is the contract: no raw reasoning, however the gateway falls back.
  const calls: Array<Record<string, unknown>> = []
  const step2 = sseResponse(content('<think>nghĩ thầm</think>') + DONE)
  const step1 = sseResponse(toolDelta({ index: 0, id: 'c1', function: { name: 'search_c11_knowledge', arguments: '{"query":"x"}' } }) + DONE)
  await withProvider([step1, step2], async () => {
    const { relayed } = await run({ tools: [knowledgeTool(calls)] })
    assert.equal(relayed, '')
  })
})

// ─── Tools offered, model answers directly ───────────────────────────────────

test('direct answer: what step 1 already streamed is not asked for, and sent, a second time', async () => {
  // Regression: step 1 streams the model's answer to the visitor. When it called no
  // tool, the "answered directly" branch then made ANOTHER streaming request and
  // appended its text — the visitor received two different answers glued together
  // ("…ạ?Chào anh/chị…"), and the provider was billed twice.
  const calls: Array<Record<string, unknown>> = []
  const first = sseResponse(content('Chào anh/chị, ') + content('tôi là Trợ lý Hướng Thiện.') + usage(2100, 14) + DONE, 6)
  const second = sseResponse(content('Một câu trả lời KHÁC không được xuất hiện.') + DONE)
  await withProvider([first, second], async (requests) => {
    const { result, relayed } = await run({ tools: [knowledgeTool(calls)] })
    assert.equal(requests.length, 1, 'the answer was already delivered; a second request is wasted spend and a duplicate')
    assert.equal(relayed, 'Chào anh/chị, tôi là Trợ lý Hướng Thiện.')
    assert.ok(result.ok && result.text === 'Chào anh/chị, tôi là Trợ lý Hướng Thiện.')
    assert.deepEqual(calls, [])
    assert.equal(result.ok && result.promptTokens, 100)
    assert.equal(result.ok && result.completionTokens, 14)
  })
})

test('direct answer: when step 1 streamed nothing visible, the follow-up request is still made', async () => {
  const calls: Array<Record<string, unknown>> = []
  const first = sseResponse(content('<think>chỉ nghĩ, chưa trả lời</think>') + DONE)
  const second = sseResponse(content('Đây là câu trả lời thật.') + usage(2200, 8) + DONE)
  await withProvider([first, second], async (requests) => {
    const { result, relayed } = await run({ tools: [knowledgeTool(calls)] })
    assert.equal(requests.length, 2)
    assert.equal(requests[1]!.body.tools, undefined)
    assert.equal(relayed, 'Đây là câu trả lời thật.')
    assert.ok(result.ok && result.text === 'Đây là câu trả lời thật.')
    assert.equal(result.ok && result.promptTokens, 200)
  })
})

// ─── Callers that do not stream (legacy /api/chat) ───────────────────────────

test('no onChunk: the non-streaming tool loop still answers and sums tokens', async () => {
  const calls: Array<Record<string, unknown>> = []
  const step1 = jsonResponse({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c9', type: 'function', function: { name: 'search_c11_knowledge', arguments: '{"query":"cư trú"}' } }] } }],
    usage: { prompt_tokens: 2050, completion_tokens: 6 },
  })
  const step2 = jsonResponse({ choices: [{ message: { content: 'Đăng ký tại Công an xã.' } }], usage: { prompt_tokens: 2200, completion_tokens: 9 } })
  await withProvider([step1, step2], async (requests) => {
    const { result } = await run({ tools: [knowledgeTool(calls)], stream: false })
    assert.deepEqual(calls, [{ query: 'cư trú' }])
    assert.ok(result.ok && result.text === 'Đăng ký tại Công an xã.')
    assert.equal(result.ok && result.promptTokens, 50 + 200)
    assert.equal(result.ok && result.completionTokens, 15)
    assert.equal(requests[0]!.body.stream, false)
  })
})

// ─── One usage row per call ──────────────────────────────────────────────────

type OneRowCase = [string, Array<Response | (() => Response) | Error>, Parameters<typeof run>[0], number, Record<string, unknown>, ResolveProviderHost?]

/** Each case is one `callAi`: exactly `requestCount` requests reach the socket and exactly ONE usage row is written. */
async function assertOneRowPerCall(cases: OneRowCase[]) {
  for (const [label, responses, options, requestCount, expected, resolveHost] of cases) {
    const before = usageLog.length
    await withProvider(responses, async (requests) => {
      await run(options)
      assert.equal(requests.length, requestCount, label)
    }, resolveHost)
    const rows = usageLog.slice(before)
    assert.equal(rows.length, 1, `${label}: ${JSON.stringify(rows)}`)
    for (const [field, value] of Object.entries(expected)) assert.equal(rows[0]![field], value, `${label}: ${field}`)
    assert.deepEqual([rows[0]!.provider, rows[0]!.model], ['delify', 'test-model'], label)
  }
}

test('one usage row per answered callAi on every path — a tool loop\'s two requests are one row', async () => {
  // The Delify "double count" was never here (it was the router-history import of
  // `delify/sync.post.ts`); this pins that it cannot start here either. Green on f58c7584
  // too: the gateway wrote one row per answered call before the fix as well.
  const calls: Array<Record<string, unknown>> = []
  await assertOneRowPerCall([
    ['no tools, streamed', [sseResponse(content('Đáp.') + usage(2100, 9) + DONE)], {}, 1, { success: true, promptTokens: 100, completionTokens: 9 }],
    ['no tools, buffered', [jsonResponse({ choices: [{ message: { content: 'Đáp.' } }], usage: { prompt_tokens: 2100, completion_tokens: 9 } })], { stream: false }, 1, { success: true, promptTokens: 100, completionTokens: 9 }],
    ['tools, streamed, a tool call', [step1WithToolCall(), sseResponse(content('Cuối.') + usage(2300, 20) + DONE)], { tools: [knowledgeTool(calls)] }, 2, { success: true, promptTokens: 400, completionTokens: 32 }],
    ['tools, streamed, the follow-up after a reasoning-only step 1', [sseResponse(content('<think>x</think>') + DONE), sseResponse(content('Đáp.') + usage(2200, 8) + DONE)], { tools: [knowledgeTool(calls)] }, 2, { success: true, promptTokens: 200, completionTokens: 8 }],
    ['tools, buffered, a tool call', [
      jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_c11_knowledge', arguments: '{"query":"q"}' } }] } }], usage: { prompt_tokens: 2050, completion_tokens: 6 } }),
      jsonResponse({ choices: [{ message: { content: 'Cuối.' } }], usage: { prompt_tokens: 2200, completion_tokens: 9 } }),
    ], { tools: [knowledgeTool(calls)], stream: false }, 2, { success: true, promptTokens: 250, completionTokens: 15 }],
  ])
})

test('a failed callAi is ONE usage row too — 0 tokens, the code — whether the provider answered an error, nothing readable, or the connection failed', async () => {
  const calls: Array<Record<string, unknown>> = []
  const failed = (errorMessage: string) => ({ success: false, errorMessage, promptTokens: 0, completionTokens: 0, totalTokens: 0, costVnd: 0 })
  const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
  await assertOneRowPerCall([
    ['tools, streamed, step 2 fails after a paid step 1', [step1WithToolCall(), new Response('boom', { status: 502 })], { tools: [knowledgeTool(calls)] }, 2, failed('provider_error')],
    ['no tools, streamed, HTTP 503', [new Response('down', { status: 503 })], {}, 1, failed('provider_error')],
    ['no tools, buffered, nothing to read', [jsonResponse({ choices: [{ message: { content: '<think>x</think>' } }] })], { stream: false }, 1, failed('parse_error')],
    // The socket fails: no HTTP answer at all — still one row, never a rejected callAi.
    ['no tools, streamed, the connection resets', [reset()], {}, 1, failed('provider_error')],
    ['no tools, buffered, the connection resets', [reset()], { stream: false }, 1, failed('provider_error')],
    ['tools, buffered, step 2\'s connection resets after a paid step 1', [
      jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_c11_knowledge', arguments: '{"query":"q"}' } }] } }], usage: { prompt_tokens: 2050, completion_tokens: 6 } }),
      reset(),
    ], { tools: [knowledgeTool(calls)], stream: false }, 2, failed('provider_error')],
    // The provider's name resolves to a private address at call time: refused before any
    // byte is sent (outbound.ts), a call that failed all the same.
    ['no tools, streamed, the host resolves to a private address', [], {}, 0, failed('provider_error'), async () => [{ address: '10.0.0.5', family: 4 }]],
  ])
})

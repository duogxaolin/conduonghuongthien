/**
 * Shared harness for the slice-R5 behaviour suites of AI routes under
 * `server/api/admin/**` (comments/ai-moderate, ai/translate*, ai/editorial,
 * ai/usage, ai/budget, ai/delify/*).
 *
 * It is the `ai-test-call-behavior` harness made reusable: a real h3 app with the
 * real `admin-auth` middleware, Drizzle's MySQL SQL executed on SQLite
 * (`_sqlite-mysql-db.ts`), the real AES-GCM key envelope, the real `checkBudget`,
 * `callAi` and `logAiUsage`, and the real `safeProviderRequest` (URL policy,
 * public-address check, pinned lookup, redirect refusal, deadline) with only its two
 * network seams replaced — DNS answers and the HTTPS socket. What each fake socket
 * received is recorded in `network.sent`, so a suite asserts on the bytes a
 * provider would have seen.
 *
 * Every logger call is recorded with `inspect` (an Error's message and cause
 * included), so "nothing secret reaches the log" is checkable.
 *
 * `startAiRouteHarness` registers the module mocks and only then imports the code
 * under test: call it once, at the top of a suite, before anything else imports
 * server code. A suite that seeds an AI budget must seed it > 0 — a budget of 0
 * makes `checkBudget` ask Delify for a provider quota (its own suite) and cache the
 * answer for 60 s at module level.
 */
import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import { PassThrough } from 'node:stream'
import { mock } from 'node:test'
import { inspect } from 'node:util'
import type { EventHandler } from 'h3'
import type { MySqlTable } from 'drizzle-orm/mysql-core'

export const SECRET = 'sk-live-R5-KEY-MUST-NEVER-LEAVE-0123456789'

export type Sent = { hostname: string, path: string, method: string, headers: Record<string, string>, connectTo: string | null, body: string }
export type Reply = { status: number, headers: Record<string, string>, body: string }
export type Account = { id: number, username: string, roleId: number, roleName: string }
export type Grant = { resource: string, canRead?: boolean, canCreate?: boolean, canUpdate?: boolean, canDelete?: boolean }

export const openAiReply = (content: string, usage: Record<string, number> = { prompt_tokens: 100, completion_tokens: 50 }) =>
  JSON.stringify({ id: 'cmpl-1', choices: [{ index: 0, message: { role: 'assistant', content } }], usage })

export async function startAiRouteHarness(options: {
  extraTables?: (schema: typeof import('../server/db/schema')) => MySqlTable[]
  routes: (load: (path: string) => Promise<EventHandler>) => Promise<Array<{ method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, handler: EventHandler }>>
}) {
  process.env.JWT_SECRET = 'ai-route-harness-r5-test-secret-0123456789abcdef'
  process.env.CHATBOT_ENCRYPTION_SECRET = Buffer.alloc(32, 5).toString('base64')
  delete process.env.MFA_ENFORCEMENT
  delete process.env.USD_TO_VND_RATE

  // ─── The network seams: DNS answers and the HTTPS socket ───────────────────────
  const network = {
    dns: new Map<string, Array<{ address: string, family: 4 | 6 }>>(),
    sent: [] as Sent[],
    /** The answer for the next request; a function picks it per request. */
    reply: ((): Reply => ({ status: 200, headers: { 'content-type': 'application/json' }, body: openAiReply('ok') })) as (sent: Sent) => Reply,
  }
  async function fakeResolve(hostname: string) {
    return network.dns.get(hostname) ?? []
  }
  function fakeRequest(requestOptions: RequestOptions, onResponse: (response: never) => void) {
    const written: string[] = []
    const req = Object.assign(new EventEmitter(), {
      write(chunk: string | Uint8Array) { written.push(Buffer.from(chunk).toString('utf8')) },
      destroy() {},
      end() {
        let connectTo: string | null = null
        const lookup = requestOptions.lookup as undefined | ((host: string, opts: object, cb: (err: Error | null, address: string | Array<{ address: string }>) => void) => void)
        lookup?.(String(requestOptions.hostname), {}, (_err, address) => { connectTo = Array.isArray(address) ? address[0]!.address : address })
        const sent: Sent = {
          hostname: String(requestOptions.hostname),
          path: String(requestOptions.path),
          method: String(requestOptions.method),
          headers: Object.fromEntries(Object.entries(requestOptions.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)])),
          connectTo,
          body: written.join(''),
        }
        network.sent.push(sent)
        const reply = network.reply(sent)
        const response = Object.assign(new PassThrough(), { statusCode: reply.status, headers: reply.headers })
        queueMicrotask(() => {
          onResponse(response as never)
          response.end(Buffer.from(reply.body))
        })
      },
    })
    return req
  }

  const realOutbound = await import('../server/utils/chatbot/outbound')
  mock.module('../server/utils/chatbot/outbound', {
    namedExports: {
      ...realOutbound,
      safeProviderRequest: (request: Parameters<typeof realOutbound.safeProviderRequest>[0]) =>
        realOutbound.safeProviderRequest({ ...request, resolveHost: fakeResolve, request: fakeRequest as never }),
    },
  })

  const schema = await import('../server/db/schema')
  const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
  const { roles, permissions, users, settings, userMfaFactors, aiProviders, aiModelPricing, aiUsageLogs, aiBudgetSettings, aiServiceConfigs } = schema
  const harness = createSqliteMysqlDb([
    roles, permissions, users, settings, userMfaFactors, aiProviders, aiModelPricing, aiUsageLogs, aiBudgetSettings, aiServiceConfigs,
    ...(options.extraTables?.(schema) ?? []),
  ])

  const logged: string[] = []
  const record = (level: string) => (entry: unknown) => { logged.push(`${level} ${inspect(entry, { depth: 8 })}`) }
  mock.module('../server/utils/logger', {
    namedExports: {
      log: record('log'),
      logInfo: record('info'),
      logWarn: record('warn'),
      logError: record('error'),
      SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
    },
  })
  mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

  const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
  installH3Globals()
  const adminAuth = (await import('../server/middleware/admin-auth')).default
  const { encryptAiSecret } = await import('../server/utils/ai/crypto')
  const { signToken } = await import('../server/utils/auth')
  const policy = await import('../server/utils/mfa/policy')

  const load = async (path: string) => (await import(path) as { default: EventHandler }).default
  const server = await startHandlerServer(await options.routes(load), [adminAuth])

  function storedKey(secret = SECRET, encryptionSecret?: string) {
    const envelope = encryptAiSecret(secret, encryptionSecret)
    return {
      apiKeyCiphertext: envelope.ciphertext,
      apiKeyNonce: envelope.nonce,
      apiKeyAuthTag: envelope.authTag,
      apiKeyVersion: envelope.version,
      apiKeyKeyId: envelope.keyId,
      apiKeyLastFour: secret.slice(-4),
    }
  }

  const cookieFor = (account: Account) =>
    `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

  /** One account per call, its role holding exactly `grants`. */
  let nextId = 10
  async function account(grants: Grant[], name = 'canbo'): Promise<Account> {
    nextId += 1
    const created: Account = { id: nextId, username: `${name}${nextId}`, roleId: nextId, roleName: `Vai trò ${nextId}` }
    await harness.db.insert(roles).values({ id: created.roleId, name: created.roleName, isSystem: false })
    if (grants.length) {
      await harness.db.insert(permissions).values(grants.map(grant => ({
        roleId: created.roleId, resource: grant.resource,
        canRead: grant.canRead ?? false, canCreate: grant.canCreate ?? false, canUpdate: grant.canUpdate ?? false, canDelete: grant.canDelete ?? false,
      })))
    }
    await harness.db.insert(users).values({ id: created.id, username: created.username, email: `${created.username}@example.vn`, passwordHash: 'x', roleId: created.roleId })
    return created
  }

  /** Clear rows, caches of the MFA policy, the network log, the log lines; DNS for the usual hosts. */
  function reset() {
    harness.reset()
    policy.clearMfaPolicyCache()
    policy.clearMfaFactorCache()
    network.sent.length = 0
    network.reply = () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: openAiReply('ok') })
    network.dns = new Map([
      ['api.openai.example', [{ address: '104.18.6.192', family: 4 }]],
      ['router.delify.example', [{ address: '172.67.1.10', family: 4 }]],
    ])
    logged.length = 0
  }

  /**
   * A provider row with a stored key, a priced model, an active service using them and
   * a monthly budget > 0 (see the header). Each argument overrides the default.
   */
  async function seedAiService(input: { serviceKey: string | string[], systemPrompt?: string | null, provider?: string, baseUrl?: string, model?: string, budgetVnd?: number }) {
    const provider = input.provider ?? 'openai'
    const model = input.model ?? 'gpt-4o-mini'
    await harness.db.insert(aiProviders).values({ provider, label: `Nhãn ${provider}`, baseUrl: input.baseUrl ?? 'https://api.openai.example/v1', isActive: true, ...storedKey() })
    await harness.db.insert(aiModelPricing).values({ model, provider, promptCostPerMillion: '0.15', completionCostPerMillion: '0.6' })
    for (const serviceKey of [input.serviceKey].flat()) {
      await harness.db.insert(aiServiceConfigs).values({ serviceKey, serviceName: serviceKey, provider, model, systemPrompt: input.systemPrompt ?? null, isActive: true })
    }
    await harness.db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: input.budgetVnd ?? 1_000_000, warningThresholdPct: 80 })
  }

  /** The chat messages of the n-th provider request (OpenAI-compatible wire format). */
  function sentMessages(index = 0): Array<{ role: string, content: string }> {
    const sent = network.sent[index]
    if (!sent) throw new Error(`no provider request #${index}; ${network.sent.length} sent`)
    return (JSON.parse(sent.body) as { messages: Array<{ role: string, content: string }> }).messages
  }

  return {
    schema, harness, network, logged, server, cookieFor, account, reset, storedKey, seedAiService, sentMessages,
    request: (method: string, path: string, who: Account | null, body?: unknown) =>
      server.request(method, path, { ...(who ? { cookie: cookieFor(who) } : {}), ...(body === undefined ? {} : { body }) }),
  }
}

/** Every 8-character window of `secret` — a partial echo counts as a leak. */
export function containsSecret(text: string, secret = SECRET): boolean {
  for (let start = 0; start + 8 <= secret.length; start += 1) {
    if (text.includes(secret.slice(start, start + 8))) return true
  }
  return false
}

import assert from 'node:assert/strict'
import test, { describe, mock } from 'node:test'

import { MySqlDialect } from 'drizzle-orm/mysql-core'

import { fakeNitroApp, loadPlugin, withEnv } from './_nitro-plugin-harness.ts'

/**
 * Ba plugin chạy một lần lúc khởi động — CHẠY plugin thật:
 *  - `chatbot-encryption-secret`: production thiếu/hỏng khoá → ném (dừng boot); dev thì không;
 *  - `runtime-config-global`: cài `useRuntimeConfig` THẬT của Nitro lên `globalThis` (thiếu nó thì
 *    `analyticsHmacSecret()` rỗng mãi — ba tuần mất analytics), không đè hàm đã có;
 *  - `translation-reaper`: 60 giây sau khởi động, bản dịch kẹt `translating` > 30 phút thành `failed`.
 */

// ── DB + logger giả cho translation-reaper ────────────────────────────────────
type Query = { sql: string, params: unknown[] }
let staleRows: Array<{ id: number, articleId: number, langCode: string }> = []
let selectWhere: Query | null = null
let selectFailure: Error | null = null
let updateFailureOnId: number | null = null
const updates: Array<{ set: Record<string, unknown>, where: Query }> = []
const warnings: Array<Record<string, unknown>> = []
const dialect = new MySqlDialect()
const compile = (where: unknown): Query => dialect.sqlToQuery(where as Parameters<MySqlDialect['sqlToQuery']>[0])

mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: async (where: unknown) => {
            selectWhere = compile(where)
            if (selectFailure) throw selectFailure
            return staleRows
          },
        }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async (where: unknown) => {
            const query = compile(where)
            if (updateFailureOnId !== null && query.params.includes(updateFailureOnId)) throw new Error('update failed')
            updates.push({ set, where: query })
          },
        }),
      }),
    }),
  },
})
mock.module('../server/utils/logger', {
  namedExports: { logWarn: (fields: Record<string, unknown>) => { warnings.push(fields) } },
})
// `useRuntimeConfig` THẬT của Nitro (specifier ảo của bundle) — thay bằng bản có dấu vết.
const nitroConfig = { analytics: { hmacSecret: 'from-nitro-config', collectionEnabled: true } }
let nitroCalls = 0
mock.module('nitropack/runtime/internal/config', {
  namedExports: { useRuntimeConfig: () => { nitroCalls += 1; return nitroConfig } },
})

const encryptionPlugin = await loadPlugin('server/plugins/chatbot-encryption-secret.ts')
const runtimePlugin = await loadPlugin('server/plugins/runtime-config-global.ts')
const reaperPlugin = await loadPlugin('server/plugins/translation-reaper.ts')
const { analyticsHmacSecret, analyticsConfig, tryRuntimeConfig } = await import('../server/utils/runtime-config.ts')

const settle = () => new Promise(resolve => setImmediate(resolve))

describe('chatbot-encryption-secret', () => {
  const GOOD = Buffer.alloc(32, 7).toString('base64')
  const run = (env: Record<string, string | undefined>) => withEnv(env, () => encryptionPlugin(fakeNitroApp().app))

  test('production: khoá hợp lệ → boot tiếp; thiếu / quá ngắn / rác → ném để chặn boot', async () => {
    await run({ NODE_ENV: 'production', CHATBOT_ENCRYPTION_SECRET: GOOD })
    await assert.rejects(run({ NODE_ENV: 'production', CHATBOT_ENCRYPTION_SECRET: undefined }), /CHATBOT_ENCRYPTION_SECRET is required/)
    await assert.rejects(run({ NODE_ENV: 'production', CHATBOT_ENCRYPTION_SECRET: '' }))
    await assert.rejects(run({ NODE_ENV: 'production', CHATBOT_ENCRYPTION_SECRET: 'too-short' }))
    await assert.rejects(run({ NODE_ENV: 'production', CHATBOT_ENCRYPTION_SECRET: Buffer.alloc(8).toString('base64') }))
  })

  test('ngoài production: thiếu hoặc hỏng khoá KHÔNG chặn boot (dev chưa cấu hình AI)', async () => {
    await run({ NODE_ENV: 'development', CHATBOT_ENCRYPTION_SECRET: undefined })
    await run({ NODE_ENV: 'development', CHATBOT_ENCRYPTION_SECRET: 'too-short' })
    await run({ NODE_ENV: 'test', CHATBOT_ENCRYPTION_SECRET: GOOD })
  })
})

describe('runtime-config-global', () => {
  const globals = globalThis as Record<string, unknown>
  const saved = globals.useRuntimeConfig

  test('trước plugin: tryRuntimeConfig() không có gì và analyticsHmacSecret() rỗng (đúng lỗi 3 tuần)', () => {
    delete globals.useRuntimeConfig
    assert.equal(tryRuntimeConfig(), undefined)
    assert.equal(analyticsHmacSecret(), '')
  })

  test('sau plugin: bản THẬT của Nitro nằm trên globalThis và cấu hình analytics đọc được', async () => {
    delete globals.useRuntimeConfig
    nitroCalls = 0
    await runtimePlugin(fakeNitroApp().app)
    assert.equal(typeof globals.useRuntimeConfig, 'function')
    assert.equal(tryRuntimeConfig(), nitroConfig)
    assert.equal(analyticsHmacSecret(), 'from-nitro-config')
    assert.equal(analyticsConfig().collectionEnabled, true)
    assert.ok(nitroCalls >= 1)
  })

  test('không đè một useRuntimeConfig đã có (Nitro tương lai tự cài thì bản đó thắng)', async () => {
    const native = () => ({ analytics: { hmacSecret: 'native' } })
    globals.useRuntimeConfig = native
    await runtimePlugin(fakeNitroApp().app)
    assert.equal(globals.useRuntimeConfig, native)
    assert.equal(analyticsHmacSecret(), 'native')
  })

  test.after(() => {
    if (saved === undefined) delete globals.useRuntimeConfig
    else globals.useRuntimeConfig = saved
  })
})

describe('translation-reaper', () => {
  const reset = () => {
    staleRows = []
    selectWhere = null
    selectFailure = null
    updateFailureOnId = null
    updates.length = 0
    warnings.length = 0
  }
  async function boot(t: { mock: { timers: { enable: (o: { apis: string[] }) => void, tick: (ms: number) => void } } }) {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    await reaperPlugin(fakeNitroApp().app)
    return { fire: async () => { t.mock.timers.tick(60_000); await settle() } }
  }

  test('không chạy trước 60 giây (chờ DB init); đến 60 giây thì quét đúng một lần', async (t) => {
    reset()
    t.mock.timers.enable({ apis: ['setTimeout'] })
    await reaperPlugin(fakeNitroApp().app)
    t.mock.timers.tick(59_999)
    await settle()
    assert.equal(selectWhere, null, 'quét sớm hơn 60 giây')
    t.mock.timers.tick(1)
    await settle()
    assert.ok(selectWhere, 'đến 60 giây phải quét')
  })

  test('timer 60 giây được unref (như mọi scheduler khác): một lượt dọn chưa chạy không giữ tiến trình sống lúc tắt', async (t) => {
    reset()
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const realSetTimeout = globalThis.setTimeout
    let unrefCalls = 0
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handle = realSetTimeout(...args) as ReturnType<typeof setTimeout>
      const original = handle.unref.bind(handle)
      handle.unref = () => { unrefCalls += 1; return original() }
      return handle
    }) as typeof setTimeout
    try {
      await reaperPlugin(fakeNitroApp().app)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    assert.equal(unrefCalls, 1, 'timer khởi động của reaper phải được unref')
  })

  test('điều kiện truy vấn: status = translating và updated_at cũ hơn 30 phút (tham số 30)', async (t) => {
    reset()
    await (await boot(t)).fire()
    assert.ok(selectWhere)
    assert.match(selectWhere.sql, /`status` = 'translating'/)
    assert.match(selectWhere.sql, /`updated_at` < DATE_SUB\(NOW\(\), INTERVAL \? MINUTE\)/)
    assert.deepEqual(selectWhere.params, [30])
  })

  test('mỗi hàng kẹt → failed + thông báo tiếng Việt, đúng id, và một dòng log cảnh báo', async (t) => {
    reset()
    staleRows = [{ id: 11, articleId: 3, langCode: 'en' }, { id: 12, articleId: 4, langCode: 'zh' }]
    await (await boot(t)).fire()
    assert.equal(updates.length, 2)
    assert.deepEqual(updates.map(update => update.where.params), [[11], [12]])
    for (const update of updates) {
      assert.deepEqual(update.set, { status: 'failed', errorMessage: 'Tiến trình bị gián đoạn (process restart).' })
    }
    assert.deepEqual(warnings, [
      { event: 'translation.reaper_marked_stale', articleId: 3, langCode: 'en', translationId: 11 },
      { event: 'translation.reaper_marked_stale', articleId: 4, langCode: 'zh', translationId: 12 },
    ])
  })

  test('không có hàng kẹt → không ghi gì, không log', async (t) => {
    reset()
    await (await boot(t)).fire()
    assert.deepEqual(updates, [])
    assert.deepEqual(warnings, [])
  })

  test('lỗi DB khi quét bị nuốt (không sập khởi động) và không ghi gì', async (t) => {
    reset()
    selectFailure = new Error('ECONNREFUSED')
    staleRows = [{ id: 1, articleId: 1, langCode: 'en' }]
    await (await boot(t)).fire()
    assert.deepEqual(updates, [])
    assert.deepEqual(warnings, [])
  })

  test('một hàng cập nhật lỗi thì dừng lượt, lỗi bị nuốt (hàng sau để lượt khởi động kế tiếp)', async (t) => {
    reset()
    staleRows = [{ id: 1, articleId: 1, langCode: 'en' }, { id: 2, articleId: 2, langCode: 'zh' }]
    updateFailureOnId = 1
    await (await boot(t)).fire()
    assert.deepEqual(updates, [])
    assert.deepEqual(warnings, [])
  })
})

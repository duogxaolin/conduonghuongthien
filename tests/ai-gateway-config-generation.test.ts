import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Bản cấu hình dịch vụ / nhà cung cấp mà gateway AI giữ 60 s (`server/services/ai-gateway-config.ts`) bị
 * bỏ ngay khi phiên bản cache câu trả lời tăng (`bumpAnswerCacheVersion` → `utils/config-generation.ts`).
 *
 * Lỗi gốc (verifier 2026-11-06): cán bộ đổi model của trợ lý → phiên bản tăng → trong ~60 s model CŨ vẫn
 * trả lời, câu đó được ghi dưới khoá MỚI và phát lại tới 30 ngày.
 */

mock.module('../server/utils/logger', {
  namedExports: { log: () => {}, logInfo: () => {}, logWarn: () => {}, logError: () => {}, SECURITY_EVENTS: {} },
})
let bumpFails = false
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      execute: async () => {
        if (bumpFails) throw new Error('database unavailable')
        return [{ affectedRows: 1 }]
      },
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ version: 2 }] }) }) }),
    }),
    getPool: () => null,
  },
})

const { loadServiceConfig, loadProvider } = await import('../server/services/ai-gateway-config')
const { advanceConfigGeneration } = await import('../server/utils/config-generation')
const { bumpAnswerCacheVersion } = await import('../server/services/chatbot-answer-cache')

let reads = 0
/** CSDL giả: mỗi lượt đọc trả model hiện tại; `gate` cho phép giữ lượt đọc lại giữa chừng. */
const state = { model: 'model-cu', gate: null as null | Promise<void> }
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          reads += 1
          const model = state.model
          if (state.gate) await state.gate
          return [{ serviceKey: 'chatbot', provider: 'openai', model }]
        },
      }),
    }),
  }),
} as never

test('the copy is reused inside the window, and dropped at once when the generation advances', async () => {
  reads = 0
  assert.equal((await loadServiceConfig(db, 'chatbot'))?.model, 'model-cu')
  await loadServiceConfig(db, 'chatbot')
  assert.equal(reads, 1, 'same generation inside 60 s must not hit the database')

  state.model = 'model-moi'
  advanceConfigGeneration()
  assert.equal((await loadServiceConfig(db, 'chatbot'))?.model, 'model-moi', 'the old model answered after the bump')
  assert.equal(reads, 2)

  // Hàng nhà cung cấp cũng vậy (khoá API, baseUrl đi theo hàng này).
  await loadProvider(db, 'openai')
  const before = reads
  advanceConfigGeneration()
  await loadProvider(db, 'openai')
  assert.equal(reads, before + 1)
})

test('a load that started before the bump is not taken as fresh afterwards', async () => {
  state.model = 'ban-cu'
  advanceConfigGeneration()
  let release!: () => void
  state.gate = new Promise<void>((resolve) => { release = resolve })
  // Lượt đọc bắt đầu (thấy "ban-cu"), rồi cán bộ đổi model và tăng thế hệ trong lúc nó còn chờ.
  const slow = loadServiceConfig(db, 'chatbot')
  state.model = 'ban-moi'
  advanceConfigGeneration()
  state.gate = null
  release()
  assert.equal((await slow)?.model, 'ban-cu')
  // Bản lượt chậm ghi mang thế hệ CŨ ⇒ lượt kế tiếp đọc lại.
  assert.equal((await loadServiceConfig(db, 'chatbot'))?.model, 'ban-moi')
})

test('bumping the answer-cache version advances the generation — and never throws', async () => {
  state.model = 'truoc-bump'
  await loadServiceConfig(db, 'chatbot')
  state.model = 'sau-bump'
  assert.equal(await bumpAnswerCacheVersion(), 2)
  assert.equal((await loadServiceConfig(db, 'chatbot'))?.model, 'sau-bump')

  // CSDL hỏng: lượt ghi dữ liệu nền đã commit; tăng phiên bản báo `null` (và log), thế hệ vẫn tăng.
  bumpFails = true
  state.model = 'khi-csdl-hong'
  try {
    assert.equal(await bumpAnswerCacheVersion(), null)
  } finally {
    bumpFails = false
  }
  assert.equal((await loadServiceConfig(db, 'chatbot'))?.model, 'khi-csdl-hong')
})

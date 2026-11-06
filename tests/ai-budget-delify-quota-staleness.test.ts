import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Quota Delify đệm 60 s (`loadDelifyQuota`, `server/utils/ai-budget.ts`) CHẶN mọi lượt gọi AI khi khoá bị tạm
 * khoá (`active: false`) — nó không phải số liệu hiển thị.
 *
 * Lỗi gốc (verifier 2026-11-06): khi hàng Delify không còn khoá (đã xoá nhà cung cấp, đổi sang nhà khác), lượt
 * tra trả lại quota CŨ — `active: false` của khoá đã bị treo cứ thế chặn MỌI dịch vụ AI (chatbot lùi về chỉ
 * trả lời từ kho) tới khi khởi động lại tiến trình. Và mỗi lần đổi khoá phải đợi hết 60 s.
 */

const state = {
  row: null as null | Record<string, unknown>,
  usage: { active: false, budgetUsd: null as number | null },
  fetches: 0,
}

mock.module('../server/utils/ai/delify-usage', {
  namedExports: {
    fetchDelifyUsage: async () => {
      state.fetches += 1
      return { data: state.usage }
    },
  },
})
mock.module('../server/utils/ai/crypto', { namedExports: { decryptAiSecret: () => 'secret' } })
mock.module('../server/utils/logger', {
  namedExports: { log: () => {}, logInfo: () => {}, logWarn: () => {}, logError: () => {}, SECURITY_EVENTS: {} },
})

const { aiProviders, aiBudgetSettings } = await import('../server/db/schema')
const { checkBudget, loadDelifyQuota } = await import('../server/utils/ai-budget')
const { advanceConfigGeneration } = await import('../server/utils/config-generation')

const KEYED = { provider: 'delify', baseUrl: 'https://router.delify.vn', apiKeyCiphertext: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 'v1', apiKeyKeyId: 'k', apiKeyLastFour: '1234' }

const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => {
        if (table === aiProviders) return { limit: async () => (state.row ? [state.row] : []) }
        if (table === aiBudgetSettings) return { limit: async () => [{ id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80 }] }
        return Promise.resolve([{ total: 0 }])
      },
    }),
  }),
} as never

test('a deleted Delify provider no longer blocks AI with its suspended key\'s quota', async () => {
  state.row = KEYED
  state.usage = { active: false, budgetUsd: null }
  advanceConfigGeneration()
  assert.equal((await loadDelifyQuota(db))?.active, false)
  assert.equal((await checkBudget(db, 'chatbot')).allowed, false, 'precondition: the suspended key blocks AI')

  // Cán bộ xoá nhà cung cấp Delify (handler tăng phiên bản cache ⇒ thế hệ cấu hình tăng) và chuyển sang nhà khác.
  state.row = null
  advanceConfigGeneration()
  assert.equal(await loadDelifyQuota(db), null, 'a provider that is gone has no quota')
  assert.equal((await checkBudget(db, 'chatbot')).allowed, true, 'AI must work again without a restart')
})

test('inside one generation the 60 s window still saves the lookup; a bump looks up again at once', async () => {
  state.row = KEYED
  state.usage = { active: true, budgetUsd: null }
  advanceConfigGeneration()
  await loadDelifyQuota(db)
  const before = state.fetches
  await loadDelifyQuota(db)
  assert.equal(state.fetches, before, 'same generation inside the window must not call Delify again')

  // Khoá mới được nhập (thao tác provider ⇒ tăng thế hệ): quota mới có hiệu lực ngay, không đợi 60 s.
  state.usage = { active: false, budgetUsd: null }
  advanceConfigGeneration()
  assert.equal((await loadDelifyQuota(db))?.active, false)
  assert.equal(state.fetches, before + 1)
})

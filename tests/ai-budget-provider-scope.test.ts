import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * The Delify quota (`loadDelifyQuota`) gates AI. Before this, `checkBudget` applied it to EVERY service: a
 * Delify key suspended by Delify ("active: false") refused all AI — including a service the admin had already
 * pointed at another provider. The admin's provider "off" switch does not help: the gateway never reads it
 * (only the SERVICE's own `isActive`), so the provider a service uses is the service's `provider` column.
 *
 * Decision (owner, 2026-11-07): the Delify quota applies only to a service that actually uses Delify. A service
 * with no config row keeps the old behaviour (Delify quota applies) — an unknown provider is not a licence to skip.
 */

const state = {
  serviceRow: null as null | { provider: string },
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

const { aiProviders, aiBudgetSettings, aiServiceConfigs } = await import('../server/db/schema')
const { checkBudget } = await import('../server/utils/ai-budget')
const { advanceConfigGeneration } = await import('../server/utils/config-generation')

const DELIFY_ROW = { provider: 'delify', baseUrl: 'https://router.delify.vn', isActive: true, apiKeyCiphertext: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 'v1', apiKeyKeyId: 'k', apiKeyLastFour: '1234' }

const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => {
        if (table === aiProviders) return { limit: async () => [DELIFY_ROW] }
        if (table === aiBudgetSettings) return { limit: async () => [{ id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80 }] }
        if (table === aiServiceConfigs) return { limit: async () => (state.serviceRow ? [state.serviceRow] : []) }
        return Promise.resolve([{ total: 0 }])
      },
    }),
  }),
} as never

function suspended() {
  state.usage = { active: false, budgetUsd: null }
  state.fetches = 0
  advanceConfigGeneration() // a fresh quota lookup each test, not the 60 s cache of the one before
}

test('a service on ANOTHER provider is not refused by a suspended Delify key — and Delify is not even asked', async () => {
  suspended()
  state.serviceRow = { provider: 'openai' }
  const result = await checkBudget(db, 'chatbot')
  assert.equal(result.allowed, true)
  assert.equal(state.fetches, 0, 'no lookup of a quota that does not apply to this service')
})

test('a service that uses Delify is still refused when its key is suspended', async () => {
  suspended()
  state.serviceRow = { provider: 'delify' }
  const result = await checkBudget(db, 'chatbot')
  assert.equal(result.allowed, false)
  assert.equal(result.reason, 'budget_exceeded')
})

test('a service with no config row keeps the old behaviour: the Delify quota applies', async () => {
  suspended()
  state.serviceRow = null
  assert.equal((await checkBudget(db, 'test_call')).allowed, false)
})

test('a caller that already knows the provider passes it and no config row is read', async () => {
  suspended()
  state.serviceRow = { provider: 'delify' }
  assert.equal((await checkBudget(db, 'chatbot', 'openai')).allowed, true, 'the passed provider wins')
  assert.equal((await checkBudget(db, 'chatbot', 'delify')).allowed, false)
})

test('a failing lookup of the service row falls back to the old behaviour instead of skipping the quota', async () => {
  suspended()
  const broken = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === aiServiceConfigs) throw new Error('database unavailable')
          return (db as { select: () => { from: (t: unknown) => { where: () => unknown } } }).select().from(table).where()
        },
      }),
    }),
  } as never
  assert.equal((await checkBudget(broken, 'chatbot')).allowed, false, 'unknown provider: Delify quota still applies')
})

test.after(() => mock.reset())

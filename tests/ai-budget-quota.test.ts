import test from 'node:test'
import assert from 'node:assert/strict'
import type { Database } from '../server/utils/db.ts'
import { checkBudget } from '../server/utils/ai-budget.ts'

test('checkBudget allows call when budget is unlimited (0)', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => [{ id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80 }],
        }),
      }),
    }),
  } as unknown as Database

  const result = await checkBudget(fakeDb, 'chatbot')
  assert.equal(result.allowed, true)
})

test('checkBudget blocks call and returns "Hệ thống hết ngân sách cho AI" when quota is exhausted', async () => {
  let queryCount = 0
  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => {
          queryCount++
          if (queryCount === 1) {
            // loadBudget
            return {
              limit: () => [{ id: 1, monthlyBudgetVnd: 1000, warningThresholdPct: 80 }],
            }
          }
          // loadMonthlySpend
          return [{ total: 1500 }]
        },
      }),
    }),
  } as unknown as Database

  // Test across multiple services: chatbot, translation, test_call, editorial
  for (const service of ['chatbot', 'translation_article', 'test_call', 'editorial_assistant']) {
    queryCount = 0
    const result = await checkBudget(mockDb, service)
    assert.equal(result.allowed, false, `Service ${service} must be blocked when quota is exhausted`)
    assert.equal(result.reason, 'budget_exceeded')
    assert.ok(result.errorMessage?.includes('Hệ thống hết ngân sách cho AI'), `Error message must say "Hệ thống hết ngân sách cho AI", got: ${result.errorMessage}`)
  }
})

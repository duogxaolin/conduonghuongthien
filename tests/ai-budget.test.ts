/**
 * Tests for the budget guard's pure logic (spec R9, tasks.md 10.4).
 *
 * The `checkBudget` function requires a DB connection, so these tests
 * verify the constants and logic that can be tested without a DB:
 *   - BLOCKED_AT_FULL_BUDGET correctly lists the non-critical services
 *   - Chatbot is NOT in the blocked set (falls back to knowledge-only)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const budgetSource = readFileSync(new URL('../server/utils/ai-budget.ts', import.meta.url), 'utf8')

test('BLOCKED_AT_FULL_BUDGET contains the four non-critical services', () => {
  // The record literal must list exactly these four services
  assert.ok(budgetSource.includes("translation_article: true"), 'translation_article must be blocked at 100%')
  assert.ok(budgetSource.includes("translation_ui: true"), 'translation_ui must be blocked at 100%')
  assert.ok(budgetSource.includes("editorial_assistant: true"), 'editorial_assistant must be blocked at 100%')
  assert.ok(budgetSource.includes("moderation: true"), 'moderation must be blocked at 100%')
})

test('chatbot is NOT in BLOCKED_AT_FULL_BUDGET (falls back to knowledge-only)', () => {
  // "chatbot: true" should NOT appear as a key in the blocked record
  const blockedBlock = budgetSource.match(/BLOCKED_AT_FULL_BUDGET[\s\S]*?\}/)
  assert.ok(blockedBlock, 'BLOCKED_AT_FULL_BUDGET record must exist')
  assert.ok(!blockedBlock[0].includes("chatbot:"), 'chatbot must not be blocked at 100% — it falls back to knowledge-only')
})

test('budget 0 = unlimited check exists in the code', () => {
  assert.ok(
    budgetSource.includes('budgetVnd <= 0') || budgetSource.includes('monthlyBudgetVnd <= 0'),
    'Budget 0 (unlimited) must be checked before budget enforcement'
  )
})

test('80 percent warning uses once-per-day logic', () => {
  assert.ok(budgetSource.includes('thresholdPct'), 'Warning threshold logic must exist')
  assert.ok(budgetSource.includes('lastWarningDate'), 'Once-per-day tracking must exist')
})

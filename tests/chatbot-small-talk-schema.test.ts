/**
 * The everyday-reply table must be declared in BOTH places the project treats as
 * schema truth: server/db/schema.ts (Drizzle) and server/db/init.ts (idempotent
 * DDL). npm run db:drift is the CI gate that compares them; this test is a fast,
 * MySQL-free tripwire that the table and its key columns exist in both, so a
 * half-applied edit is caught before the drift job runs.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../server/db/schema.ts', import.meta.url), 'utf8')
const init = readFileSync(new URL('../server/db/init.ts', import.meta.url), 'utf8')

test('chatbot_small_talk is declared in schema.ts with its type exports', () => {
  assert.match(schema, /mysqlTable\('chatbot_small_talk'/u)
  assert.match(schema, /export type ChatbotSmallTalk = typeof chatbotSmallTalk\.\$inferSelect/u)
  assert.match(schema, /export type NewChatbotSmallTalk/u)
})

test('chatbot_small_talk is created in init.ts with the unique key and runtime index', () => {
  assert.match(init, /CREATE TABLE IF NOT EXISTS \\`chatbot_small_talk\\`/u)
  assert.match(init, /UNIQUE KEY \\`chatbot_small_talk_normalized_question_idx\\`/u)
  assert.match(init, /KEY \\`chatbot_small_talk_enabled_category_id_idx\\`/u)
})

test('the columns the matcher and admin service depend on exist in both files', () => {
  for (const column of ['category', 'normalizedQuestion', 'answer', 'patterns', 'isEnabled', 'isSystem', 'displayOrder']) {
    assert.ok(schema.includes(column), `schema.ts is missing column ${column}`)
  }
  // The DDL lives in a template literal, so backticks are escaped in source (\`col\`).
  for (const column of ['category', 'normalized_question', 'answer', 'patterns', 'is_enabled', 'is_system', 'display_order']) {
    assert.ok(init.includes(`\\\`${column}\\\``), `init.ts is missing column ${column}`)
  }
})

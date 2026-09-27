import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_SERVICE_DEFAULT_PROMPTS } from '../server/utils/ai/prompt-defaults'

const EXPECTED_KEYS = ['chatbot', 'moderation', 'translation_article', 'translation_ui', 'editorial_assistant'] as const

test('AI_SERVICE_DEFAULT_PROMPTS covers every seeded service_key', () => {
  for (const key of EXPECTED_KEYS) {
    assert.ok(key in AI_SERVICE_DEFAULT_PROMPTS, `missing default prompt for service "${key}"`)
  }
})

test('every default prompt is non-empty and substantively specified', () => {
  for (const [key, prompt] of Object.entries(AI_SERVICE_DEFAULT_PROMPTS)) {
    assert.equal(typeof prompt, 'string', `${key} prompt must be a string`)
    assert.ok(prompt.trim().length > 50, `${key} prompt must be substantive (>50 chars), got ${prompt.trim().length}`)
    assert.ok(!prompt.includes('{{question}}') || key === 'chatbot', `${key} prompt must not carry chatbot template vars`)
  }
})

test('moderation default prompt carries the Party-history guardrails (khen vs chê, dcs/đcs, VNCH)', () => {
  const p = AI_SERVICE_DEFAULT_PROMPTS.moderation
  assert.match(p, /Đảng Cộng sản Việt Nam/)
  assert.match(p, /dcs.*đcs/i)
  assert.match(p, /Việt Nam Cộng hòa|VNCH/)
  assert.match(p, /khôi phục|ca ngợi|khen/i, 'must distinguish khen vs chê')
})

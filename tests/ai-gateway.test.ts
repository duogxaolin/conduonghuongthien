/**
 * Tests for the AI gateway's pure functions (spec R5.5, R10.1 step 5).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// Dynamic import works here since substituteVariables is exported and pure
const { substituteVariables } = await import('../server/services/ai-gateway.ts')

test('substituteVariables replaces known placeholders', () => {
  const result = substituteVariables(
    'Hello {{name}}, your question is: {{question}}',
    { name: 'Huong', question: 'Giúp tôi' },
  )
  assert.equal(result, 'Hello Huong, your question is: Giúp tôi')
})

test('substituteVariables leaves unknown placeholders as-is', () => {
  const result = substituteVariables(
    'Hello {{name}}, {{unknown}} stays',
    { name: 'Huong' },
  )
  assert.equal(result, 'Hello Huong, {{unknown}} stays')
})

test('substituteVariables handles empty variables map', () => {
  const result = substituteVariables('Prompt with {{question}} placeholder', {})
  assert.equal(result, 'Prompt with {{question}} placeholder')
})

test('substituteVariables handles empty prompt', () => {
  const result = substituteVariables('', { foo: 'bar' })
  assert.equal(result, '')
})

test('substituteVariables handles prompt with no placeholders', () => {
  const result = substituteVariables('No placeholders here', { foo: 'bar' })
  assert.equal(result, 'No placeholders here')
})

test('substituteVariables replaces multiple occurrences of same key', () => {
  const result = substituteVariables('{{x}} and {{x}}', { x: 'value' })
  assert.equal(result, 'value and value')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateAiCost, type AiModelPricingEntry } from '../server/utils/ai-cost.ts'

test('calculateAiCost returns zero cost when pricing is null', () => {
  const result = calculateAiCost('gemini-1.5-flash', 100, 50, null)
  assert.equal(result.costUsd, 0)
  assert.equal(result.costVnd, 0)
})

test('calculateAiCost returns zero when model not found (pricing is null)', () => {
  const result = calculateAiCost('unknown-model', 100, 50, null)
  assert.equal(result.costUsd, 0)
  assert.equal(result.costVnd, 0)
})

test('calculateAiCost computes correct USD and VND for normal input', () => {
  const pricing: AiModelPricingEntry = {
    model: 'gpt-4o',
    promptCostPerMillion: '2.5000',
    completionCostPerMillion: '10.0000',
  }
  // costUsd = (1000 * 2.5 + 500 * 10) / 1_000_000 = (2500 + 5000) / 1_000_000 = 0.0075
  const result = calculateAiCost('gpt-4o', 1000, 500, pricing)
  assert.ok(Math.abs(result.costUsd - 0.0075) < 0.000001)
  // costVnd = 0.0075 * 25500 = 191.25
  assert.ok(Math.abs(result.costVnd - 191.25) < 0.01)
})

test('calculateAiCost handles zero tokens', () => {
  const pricing: AiModelPricingEntry = {
    model: 'gemini-1.5-flash',
    promptCostPerMillion: '0.0750',
    completionCostPerMillion: '0.3000',
  }
  const result = calculateAiCost('gemini-1.5-flash', 0, 0, pricing)
  assert.equal(result.costUsd, 0)
  assert.equal(result.costVnd, 0)
})

test('calculateAiCost clamps negative tokens to zero', () => {
  const pricing: AiModelPricingEntry = {
    model: 'claude-3-5-sonnet',
    promptCostPerMillion: '3.0000',
    completionCostPerMillion: '15.0000',
  }
  const result = calculateAiCost('claude-3-5-sonnet', -100, -50, pricing)
  assert.equal(result.costUsd, 0)
  assert.equal(result.costVnd, 0)
})

test('calculateAiCost handles numeric pricing values', () => {
  const pricing: AiModelPricingEntry = {
    model: 'deepseek-chat',
    promptCostPerMillion: 0.14, // numeric instead of string
    completionCostPerMillion: 0.28,
  }
  // costUsd = (10000 * 0.14 + 5000 * 0.28) / 1_000_000 = (1400 + 1400) / 1_000_000 = 0.0028
  const result = calculateAiCost('deepseek-chat', 10000, 5000, pricing)
  assert.ok(Math.abs(result.costUsd - 0.0028) < 0.000001)
})

test('calculateAiCost returns zero when pricing has NaN values', () => {
  const pricing: AiModelPricingEntry = {
    model: 'bad-model',
    promptCostPerMillion: 'not-a-number',
    completionCostPerMillion: 'also-not-a-number',
  }
  const result = calculateAiCost('bad-model', 100, 50, pricing)
  assert.equal(result.costUsd, 0)
  assert.equal(result.costVnd, 0)
})

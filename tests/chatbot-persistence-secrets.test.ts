import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import {
  ChatbotEncryptionError,
  decryptChatbotSecret,
  encryptChatbotSecret,
  validateChatbotEncryptionSecret,
} from '../server/utils/chatbot/crypto'
import {
  buildChatbotApiKeyClearPatch,
  buildChatbotSettingsPatch,
  ChatbotSettingsValidationError,
} from '../server/utils/chatbot/settings'
import { serializeChatbotSettings } from '../server/utils/chatbot/serializers'
import {
  chatbotIndexMigrations,
  chatbotOptionalColumns,
  chatbotRequiredColumnMigrations,
} from '../server/db/init'

const secret = randomBytes(32).toString('base64')

test('AES-256-GCM round trips and rejects tampering without plaintext diagnostics', () => {
  const encrypted = encryptChatbotSecret('provider-key-1234', secret)
  assert.equal(decryptChatbotSecret(encrypted, secret), 'provider-key-1234')
  assert.equal(encrypted.version, 1)
  assert.equal(encrypted.lastFour, '1234')
  assert.doesNotMatch(JSON.stringify(encrypted), /provider-key/)

  for (const field of ['ciphertext', 'nonce', 'authTag', 'keyId'] as const) {
    const tampered = { ...encrypted, [field]: `${encrypted[field].slice(0, -2)}AA` }
    assert.throws(() => decryptChatbotSecret(tampered, secret), ChatbotEncryptionError)
  }
  assert.throws(() => decryptChatbotSecret({ ...encrypted, version: 2 }, secret), ChatbotEncryptionError)
})

test('encryption key validation is strong and production fails closed', () => {
  assert.equal(validateChatbotEncryptionSecret({ secret, production: true }), true)
  assert.equal(validateChatbotEncryptionSecret({ secret: 'weak', production: false }), false)
  assert.throws(() => validateChatbotEncryptionSecret({ secret: 'weak', production: true }), ChatbotEncryptionError)
  assert.throws(() => validateChatbotEncryptionSecret({ secret: undefined, production: true }), ChatbotEncryptionError)
})

test('settings patch preserves omitted key, encrypts replacement, and clears only explicitly', () => {
  const ordinary = buildChatbotSettingsPatch({ model: 'safe-model' }, secret)
  assert.deepEqual(ordinary, { model: 'safe-model' })

  const replacement = buildChatbotSettingsPatch({ apiKey: 'new-secret-9876' }, secret)
  assert.equal(replacement.apiKeyLastFour, '9876')
  assert.ok(replacement.apiKeyCiphertext)
  assert.doesNotMatch(JSON.stringify(replacement), /new-secret/)
  assert.throws(() => buildChatbotSettingsPatch({ apiKey: '' }, secret), ChatbotSettingsValidationError)
  assert.deepEqual(buildChatbotApiKeyClearPatch(), {
    apiKeyCiphertext: null,
    apiKeyNonce: null,
    apiKeyAuthTag: null,
    apiKeyVersion: null,
    apiKeyKeyId: null,
    apiKeyLastFour: null,
  })
})

test('settings serializer exposes only masked/status fields', () => {
  const serialized = serializeChatbotSettings({
    id: 1,
    enabled: false,
    providerPolicy: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    model: 'safe-model',
    systemPrompt: 'private prompt marker',
    allowedHosts: ['api.example.test'],
    requestTimeoutMs: 10000,
    maxResponseBytes: 262144,
    maxInputChars: 2000,
    maxHistoryMessages: 8,
    retrievalTopK: 3,
    referenceCharBudget: 6000,
    rateLimitRequests: 10,
    rateLimitWindowSeconds: 60,
    apiKeyCiphertext: 'ciphertext-marker',
    apiKeyNonce: 'nonce-marker',
    apiKeyAuthTag: 'tag-marker',
    apiKeyVersion: 1,
    apiKeyKeyId: 'key-id-marker',
    apiKeyLastFour: '9876',
    updatedBy: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const output = JSON.stringify(serialized)
  assert.equal(serialized.apiKeyMasked, '••••9876')
  assert.equal(serialized.systemPromptConfigured, true)
  assert.doesNotMatch(output, /ciphertext-marker|nonce-marker|tag-marker|key-id-marker|private prompt marker/)
})

test('chatbot DDL plan is additive, unique, and deterministic for existing installs', () => {
  const requiredKeys = chatbotRequiredColumnMigrations.map(({ table, column }) => `${table}.${column}`)
  assert.equal(new Set(requiredKeys).size, requiredKeys.length)
  for (const migration of chatbotRequiredColumnMigrations) {
    assert.match(migration.nullableDefinition, / NULL(?:$| )/i)
    assert.match(migration.finalDefinition, / NOT NULL/i)
    assert.notEqual(migration.backfillExpression.trim(), '')
  }
  const optionalKeys = chatbotOptionalColumns.map(([table, column]) => `${table}.${column}`)
  assert.equal(new Set(optionalKeys).size, optionalKeys.length)
  const indexKeys = chatbotIndexMigrations.map(([table, name]) => `${table}.${name}`)
  assert.equal(new Set(indexKeys).size, indexKeys.length)
  assert.ok(indexKeys.includes('chatbot_knowledge.chatbot_knowledge_status_priority_id_idx'))
  assert.ok(indexKeys.includes('chatbot_knowledge_terms.chatbot_terms_kind_normalized_knowledge_idx'))
})

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ChatbotEncryptionError, decryptChatbotSecret, encryptChatbotSecret } from '../server/utils/chatbot/crypto'
import { validateChatbotStartupEnvironment } from '../server/utils/chatbot/startup'

const validSecret = randomBytes(32).toString('base64')

test('production startup accepts a valid chatbot encryption secret', () => {
  assert.equal(validateChatbotStartupEnvironment({ NODE_ENV: 'production', CHATBOT_ENCRYPTION_SECRET: validSecret }), true)
})

test('production startup fails immediately for missing or malformed secrets without leaking values', () => {
  const marker = 'malformed-secret-value'
  for (const environment of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', CHATBOT_ENCRYPTION_SECRET: marker },
  ]) {
    let caught: unknown
    try { validateChatbotStartupEnvironment(environment) } catch (error) { caught = error }
    assert.ok(caught instanceof ChatbotEncryptionError)
    assert.doesNotMatch(String(caught), new RegExp(marker))
  }
})

test('development and test startup remain usable without a secret, but credential operations fail closed', () => {
  assert.equal(validateChatbotStartupEnvironment({ NODE_ENV: 'development' }), false)
  assert.equal(validateChatbotStartupEnvironment({ NODE_ENV: 'test', CHATBOT_ENCRYPTION_SECRET: 'weak' }), false)
  assert.throws(() => encryptChatbotSecret('provider-key'), ChatbotEncryptionError)
  assert.throws(() => decryptChatbotSecret({ ciphertext: 'AA==', nonce: 'AA==', authTag: 'AA==', version: 1, keyId: 'missing', lastFour: '' }), ChatbotEncryptionError)
})

/**
 * server/utils/secret-envelope.ts is the shared AES-256-GCM factory behind
 * every stored secret in this codebase. Two things must hold for the
 * generalization to be safe (design.md D3, reader-google-login-comments):
 *
 *   1. The chatbot wrapper (server/utils/chatbot/crypto.ts) must still decrypt
 *      every ciphertext written by the pre-refactor, hand-written module —
 *      checked against a FIXED known-good envelope, not a round-trip, because a
 *      round-trip through the new code would pass even if the context label
 *      had silently changed underneath it.
 *   2. Two features bound to different context labels must be mutually
 *      unreadable: an envelope encrypted under one label must fail
 *      authentication (not merely a key-id mismatch) when decrypted under the
 *      other, in both directions.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'

import { createSecretEnvelope } from '../server/utils/secret-envelope.ts'
import {
  ChatbotEncryptionError,
  decryptChatbotSecret,
  encryptChatbotSecret,
} from '../server/utils/chatbot/crypto.ts'
import {
  GoogleOAuthEncryptionError,
  decryptGoogleOAuthSecret,
  encryptGoogleOAuthSecret,
} from '../server/utils/google-oauth/crypto.ts'

const secret = randomBytes(32).toString('base64')

describe('createSecretEnvelope — the shared factory', () => {
  class FixtureError extends Error {
    constructor(message?: string) { super(message); this.name = 'FixtureError' }
  }

  const codec = createSecretEnvelope({
    context: 'cdkt-fixture-secret:v1',
    envVar: 'FIXTURE_ENCRYPTION_SECRET',
    ErrorClass: FixtureError,
  })

  it('round trips and rejects tampering with its own error class', () => {
    const encrypted = codec.encryptSecret('a-fixture-plaintext-value', secret)
    assert.equal(codec.decryptSecret(encrypted, secret), 'a-fixture-plaintext-value')
    assert.equal(encrypted.version, 1)
    assert.equal(encrypted.lastFour, 'alue')
    assert.doesNotMatch(JSON.stringify(encrypted), /a-fixture-plaintext-value/)

    for (const field of ['ciphertext', 'nonce', 'authTag', 'keyId'] as const) {
      const tampered = { ...encrypted, [field]: `${encrypted[field].slice(0, -2)}AA` }
      assert.throws(() => codec.decryptSecret(tampered, secret), FixtureError)
    }
    assert.throws(() => codec.decryptSecret({ ...encrypted, version: 2 }, secret), FixtureError)
  })

  it('rejects a mismatched key with its own error class, in constant-time comparison', () => {
    const encrypted = codec.encryptSecret('value-under-key-one', secret)
    const otherSecret = randomBytes(32).toString('base64')
    assert.throws(() => codec.decryptSecret(encrypted, otherSecret), FixtureError)
  })

  it('validates the encryption secret and fails closed only in production', () => {
    assert.equal(codec.validateEncryptionSecret({ secret, production: true }), true)
    assert.equal(codec.validateEncryptionSecret({ secret: 'too-short', production: false }), false)
    assert.throws(() => codec.validateEncryptionSecret({ secret: 'too-short', production: true }), FixtureError)
    assert.throws(() => codec.validateEncryptionSecret({ secret: undefined, production: true }), FixtureError)
  })
})

describe('chatbot/crypto.ts wrapper — compatibility with the pre-refactor module', () => {
  // Generated once by calling encryptChatbotSecret('fixture-plaintext-secret-value', secret)
  // against the ORIGINAL, hand-written chatbot/crypto.ts (before it became a thin
  // wrapper over the shared factory). This is deliberately a fixed fixture rather
  // than a fresh round-trip: a round-trip through the *new* code would still pass
  // even if CONTEXT had silently drifted from 'cdkt-chatbot-provider-key:v1',
  // because the writer and reader would agree with each other while disagreeing
  // with every row already sitting in the database.
  const fixtureSecret = 'wZ4wF3n1s5m8b1qk9GxYt6bV2Rd0cLz7uHj4Np8Ss3E='
  const knownGoodEnvelope = {
    ciphertext: 'LaaTzU3IceHkyfFCjQ81x1a1NXBMI8YVF5t5gnQV',
    nonce: 'cz0EmnHjFGvYN9to',
    authTag: '+lclrUYPuuIce/3hopgntA==',
    version: 1,
    keyId: 'ea6f0fc8e4b5d997',
    lastFour: 'alue',
  }

  it('decrypts a fixed pre-refactor envelope byte-identically', () => {
    assert.equal(decryptChatbotSecret(knownGoodEnvelope, fixtureSecret), 'fixture-plaintext-secret-value')
  })

  it('still round trips and rejects tampering (regression, unchanged behaviour)', () => {
    const encrypted = encryptChatbotSecret('provider-key-1234', secret)
    assert.equal(decryptChatbotSecret(encrypted, secret), 'provider-key-1234')
    assert.equal(encrypted.lastFour, '1234')
    assert.throws(() => decryptChatbotSecret({ ...encrypted, authTag: `${encrypted.authTag.slice(0, -2)}AA` }, secret), ChatbotEncryptionError)
  })
})

describe('cross-label rejection — chatbot vs Google OAuth', () => {
  it('an envelope encrypted under the chatbot label fails authentication under the OAuth label', () => {
    const encrypted = encryptChatbotSecret('a-chatbot-provider-key', secret)
    assert.throws(() => decryptGoogleOAuthSecret(encrypted, secret), GoogleOAuthEncryptionError)
  })

  it('an envelope encrypted under the OAuth label fails authentication under the chatbot label', () => {
    const encrypted = encryptGoogleOAuthSecret('a-google-client-secret', secret)
    assert.throws(() => decryptChatbotSecret(encrypted, secret), ChatbotEncryptionError)
  })

  it('each label still round trips correctly under the same key', () => {
    const chatbotEnvelope = encryptChatbotSecret('chatbot-value-9999', secret)
    assert.equal(decryptChatbotSecret(chatbotEnvelope, secret), 'chatbot-value-9999')

    const oauthEnvelope = encryptGoogleOAuthSecret('oauth-value-8888', secret)
    assert.equal(decryptGoogleOAuthSecret(oauthEnvelope, secret), 'oauth-value-8888')
  })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkProviderBaseUrl, providerHostnameViolation } from '../server/utils/ai/provider-url.ts'
import { ChatbotOutboundError, normalizeProviderUrl } from '../server/utils/chatbot/outbound.ts'
import { chatbotDestinationChanged } from '../server/utils/chatbot/settings.ts'

/**
 * Bảng chính sách địa chỉ nhà cung cấp AI — một hàm thuần dùng chung cho lúc ghi,
 * lúc gọi (`callAi`) và cửa ra mạng (`normalizeProviderUrl`).
 */

const REJECTED: Array<[string, string]> = [
  ['http://api.openai.com/v1', 'not_https'],
  ['HTTP://api.openai.com/v1', 'not_https'],
  ['ftp://api.openai.com/v1', 'not_https'],
  ['https://user:secret@api.openai.com/v1', 'credentials'],
  ['https://:secret@api.openai.com/v1', 'credentials'],
  ['https://api.openai.com:8443/v1', 'port'],
  ['https://api.openai.com:80/v1', 'port'],
  ['https://api.openai.com/v1?key=1', 'query_or_fragment'],
  ['https://api.openai.com/v1?', 'query_or_fragment'],
  ['https://api.openai.com/v1#frag', 'query_or_fragment'],
  ['https://127.0.0.1/v1', 'ip_literal'],
  ['https://10.20.30.40/v1', 'ip_literal'],
  ['https://172.16.0.1/v1', 'ip_literal'],
  ['https://192.168.1.1/v1', 'ip_literal'],
  ['https://169.254.169.254/latest/meta-data', 'ip_literal'],
  ['https://8.8.8.8/v1', 'ip_literal'],
  ['https://[::1]/v1', 'ip_literal'],
  ['https://[fd00::1]/v1', 'ip_literal'],
  ['https://[::ffff:127.0.0.1]/v1', 'ip_literal'],
  ['https://2130706433/v1', 'ip_literal'],
  ['https://0x7f000001/v1', 'ip_literal'],
  ['https://0x7f.0.0.1/v1', 'ip_literal'],
  ['https://017700000001/v1', 'ip_literal'],
  ['https://127.1/v1', 'ip_literal'],
  ['https://localhost/v1', 'internal_name'],
  ['https://LOCALHOST/v1', 'internal_name'],
  ['https://localhost./v1', 'internal_name'],
  ['https://api.localhost/v1', 'internal_name'],
  ['https://metadata.google.internal/computeMetadata', 'internal_name'],
  ['https://printer.local/v1', 'internal_name'],
  ['https://router.home.arpa/v1', 'internal_name'],
  ['https://mysql/v1', 'internal_name'],
  ['https://cdkt_app/v1', 'internal_name'],
  ['not a url', 'invalid'],
  ['', 'invalid'],
  [`https://api.openai.com/${'a'.repeat(1100)}`, 'invalid'],
]

test('rejects every unsafe provider address with a stable reason and a Vietnamese message', () => {
  for (const [input, violation] of REJECTED) {
    const result = checkProviderBaseUrl(input)
    assert.equal(result.ok, false, input)
    if (!result.ok) {
      assert.equal(result.violation, violation, input)
      assert.match(result.message, /Địa chỉ nhà cung cấp/, input)
    }
  }
  assert.equal(checkProviderBaseUrl(null).ok, false)
  assert.equal(checkProviderBaseUrl(42).ok, false)
})

test('accepts public https providers and normalizes case, default port, trailing dot and slashes', () => {
  const accepted: Array<[string, string]> = [
    ['https://router.delify.vn/v1', 'https://router.delify.vn/v1'],
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    ['https://API.OpenAI.com/v1/', 'https://api.openai.com/v1'],
    ['https://api.openai.com:443/v1//', 'https://api.openai.com/v1'],
    ['https://api.anthropic.com.', 'https://api.anthropic.com'],
    ['  https://api.deepseek.com/v1  ', 'https://api.deepseek.com/v1'],
  ]
  for (const [input, normalized] of accepted) {
    const result = checkProviderBaseUrl(input)
    assert.ok(result.ok, input)
    if (result.ok) assert.equal(result.url, normalized, input)
  }
})

test('the egress gate refuses internal names even when an operator allowlisted them', () => {
  for (const host of ['localhost', 'metadata.google.internal', 'nas.local', 'mysql']) {
    assert.throws(
      () => normalizeProviderUrl(`https://${host}/v1`, { allowedHosts: [host] }),
      (error: unknown) => error instanceof ChatbotOutboundError && error.code === 'DESTINATION_NOT_ALLOWED',
      host,
    )
  }
  assert.equal(normalizeProviderUrl('https://api.openai.com/v1', { allowedHosts: ['api.openai.com'] }).href, 'https://api.openai.com/v1')
})

test('hostname policy on its own', () => {
  assert.equal(providerHostnameViolation('api.openai.com'), null)
  assert.equal(providerHostnameViolation('API.OPENAI.COM.'), null)
  assert.equal(providerHostnameViolation('[::1]'), 'ip_literal')
  assert.equal(providerHostnameViolation('::1'), 'ip_literal')
  assert.equal(providerHostnameViolation('router'), 'internal_name')
  assert.equal(providerHostnameViolation(''), 'invalid')
})

test('a chatbot destination change is a change of value, not the presence of a field', () => {
  const current = { baseUrl: 'https://api.provider.example/v1', allowedHosts: ['api.provider.example'] }
  assert.equal(chatbotDestinationChanged(current, {}), false)
  assert.equal(chatbotDestinationChanged(current, { enabled: true }), false)
  assert.equal(chatbotDestinationChanged(current, { baseUrl: 'https://API.provider.example/v1/' }), false)
  assert.equal(chatbotDestinationChanged(current, { allowedHosts: ['API.Provider.Example.', 'api.provider.example'] }), false)
  assert.equal(chatbotDestinationChanged(current, { baseUrl: 'https://evil.example/v1' }), true)
  assert.equal(chatbotDestinationChanged(current, { baseUrl: null }), true)
  assert.equal(chatbotDestinationChanged(current, { allowedHosts: [] }), true)
  assert.equal(chatbotDestinationChanged(current, { allowedHosts: ['api.provider.example', 'evil.example'] }), true)
  assert.equal(chatbotDestinationChanged({ baseUrl: null, allowedHosts: null }, { baseUrl: '', allowedHosts: [] }), false)
})

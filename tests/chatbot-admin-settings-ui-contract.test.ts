import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const layoutPath = new URL('../app/layouts/admin.vue', import.meta.url)
const settingsPath = new URL('../app/pages/admin/chatbot/settings.vue', import.meta.url)
const validatorPath = new URL('../server/utils/chatbot/settings.ts', import.meta.url)
const patchRoutePath = new URL('../server/api/admin/chatbot/settings/index.patch.ts', import.meta.url)
const clearRoutePath = new URL('../server/api/admin/chatbot/settings/clear.post.ts', import.meta.url)

const [layoutSource, settingsSource, validatorSource, patchRouteSource, clearRouteSource] = await Promise.all([
  readFile(layoutPath, 'utf8'),
  readFile(settingsPath, 'utf8'),
  readFile(validatorPath, 'utf8'),
  readFile(patchRoutePath, 'utf8'),
  readFile(clearRoutePath, 'utf8'),
])
const settingsSfc = parse(settingsSource, { filename: 'settings.vue' })
const settingsScript = settingsSfc.descriptor.scriptSetup?.content ?? ''
const settingsTemplate = settingsSfc.descriptor.template?.content ?? ''

const ordinaryPatchFields = [
  'enabled',
  'providerPolicy',
  'baseUrl',
  'model',
  'allowedHosts',
  'requestTimeoutMs',
  'maxResponseBytes',
  'maxInputChars',
  'maxHistoryMessages',
  'retrievalTopK',
  'referenceCharBudget',
  'rateLimitRequests',
  'rateLimitWindowSeconds',
]
const metadataFields = [
  'id',
  'systemPromptConfigured',
  'systemPromptLength',
  'hasApiKey',
  'apiKeyStatus',
  'apiKeyMasked',
  'createdAt',
  'updatedAt',
]

function extractFunction(name: string, followingName: string) {
  const start = settingsScript.indexOf(`function ${name}(`)
  const end = settingsScript.indexOf(`function ${followingName}(`, start)
  assert.notEqual(start, -1, `missing ${name}`)
  assert.notEqual(end, -1, `missing ${followingName} after ${name}`)
  return settingsScript.slice(start, end)
}

function serverIntegerBounds(field: string): [number, number] {
  const match = validatorSource.match(new RegExp(`${field}: \\[([\\d_]+), ([\\d_]+)\\]`))
  assert.ok(match, `missing server bounds for ${field}`)
  return [Number(match[1].replaceAll('_', '')), Number(match[2].replaceAll('_', ''))]
}

function templateIntegerBounds(field: string): [number, number] {
  const match = settingsTemplate.match(new RegExp(`v-model\\.number="form\\.${field}"[^>]*min="(\\d+)"[^>]*max="(\\d+)"`))
  assert.ok(match, `missing UI bounds for ${field}`)
  return [Number(match[1]), Number(match[2])]
}

test('admin navigation targets actual chatbot pages and keeps dedicated read permissions', () => {
  assert.match(layoutSource, /hasPermission\('chatbot_knowledge', 'read'\)[^\n]+path: '\/admin\/chatbot\/knowledge'/)
  assert.match(layoutSource, /hasPermission\('chatbot_settings', 'read'\)[^\n]+path: '\/admin\/chatbot\/settings'/)
  assert.doesNotMatch(layoutSource, /\/admin\/content\/chatbot-knowledge|\/admin\/settings\/chatbot/)
  assert.match(layoutSource, /path: '\/admin\/content\/home'/)
  assert.match(layoutSource, /path: '\/admin\/settings\/general'/)
})

test('settings SFC parses and keeps explicit loading, error, success, test, masked, focus, and mobile states', () => {
  assert.equal(settingsSfc.errors.length, 0)
  for (const state of ['loading', 'saving', 'clearingKey', 'testing', 'errorMessage', 'testMessage', 'dirty']) {
    assert.match(settingsScript, new RegExp(`const ${state} = ref\\(`))
  }
  assert.match(settingsScript, /toast\.success\('Đã lưu cấu hình chatbot\.'\)/)
  assert.match(settingsTemplate, /metadata\.apiKeyMasked/)
  assert.match(settingsTemplate, /role="alert"/)
  assert.match(settingsTemplate, /role="status"/)
  assert.match(settingsTemplate, /focus:ring-2/)
  assert.match(settingsTemplate, /sm:flex-row/)
  assert.match(settingsTemplate, /sm:grid-cols-2/)
})

test('GET metadata is mapped separately and cannot be spread into the editable form or PATCH payload', () => {
  assert.match(settingsScript, /const form = reactive<EditableSettings>/)
  assert.match(settingsScript, /const metadata = reactive<SettingsMetadata>/)
  const applyResponse = extractFunction('applySettingsResponse', 'buildPatchPayload')
  for (const field of ordinaryPatchFields) {
    assert.match(applyResponse, new RegExp(`form\\.${field} =`))
  }
  assert.doesNotMatch(applyResponse, /Object\.assign\(form,\s*value|\.\.\.value/)

  const payloadBuilder = extractFunction('buildPatchPayload', 'load')
  assert.match(payloadBuilder, /const body: SettingsPatch = \{/)
  assert.doesNotMatch(payloadBuilder, /\.\.\.form|\.\.\.settings|\.\.\.value/)
  for (const field of ordinaryPatchFields) assert.match(payloadBuilder, new RegExp(`${field}:`))
  for (const field of metadataFields) assert.doesNotMatch(payloadBuilder, new RegExp(`\\b${field}\\b`))

  const serverFields = patchRouteSource.match(/const FIELDS = new Set\(\[([^\]]+)\]\)/)?.[1]
  assert.ok(serverFields)
  for (const field of [...ordinaryPatchFields, 'systemPrompt', 'apiKey']) {
    assert.match(serverFields, new RegExp(`['"]${field}['"]`))
  }
})

test('system prompt and API key are omitted by default and included only as intentional replacements', () => {
  const payloadBuilder = extractFunction('buildPatchPayload', 'load')
  assert.match(payloadBuilder, /if \(prompt\.length > 0\)/)
  assert.match(payloadBuilder, /if \(!prompt\.trim\(\)\) throw new Error/)
  assert.match(payloadBuilder, /body\.systemPrompt = prompt/)
  assert.match(payloadBuilder, /const apiKey = newApiKey\.value\.trim\(\)/)
  assert.match(payloadBuilder, /if \(apiKey\) body\.apiKey = apiKey/)
  assert.doesNotMatch(payloadBuilder, /systemPrompt:\s*systemPromptReplacement|apiKey:\s*newApiKey/)

  assert.match(settingsTemplate, /metadata\.systemPromptConfigured/)
  assert.match(settingsTemplate, /metadata\.systemPromptLength/)
  assert.match(settingsTemplate, /Để trống để giữ nguyên prompt hiện tại/)
  assert.doesNotMatch(settingsScript, /value\.systemPrompt\b|form\.systemPrompt\b/)
})

test('API key clear is an explicit action and never uses blank PATCH semantics', () => {
  const clearKey = extractFunction('clearKey', 'testConnection')
  assert.match(clearKey, /window\.confirm\('Xóa API key khỏi cấu hình chatbot\?'\)/)
  assert.match(clearKey, /\$fetch\('\/api\/admin\/chatbot\/settings\/clear', \{ method: 'POST' \}\)/)
  assert.match(clearRouteSource, /clearChatbotApiKey/)
  assert.match(validatorSource, /input\.apiKey === ''[^\n]+explicit clear operation/)
  assert.doesNotMatch(clearKey, /method: 'PATCH'|apiKey:\s*''/)
})

test('timeout and response-size controls are persisted with exact server-aligned bounds', () => {
  for (const field of ['requestTimeoutMs', 'maxResponseBytes']) {
    assert.deepEqual(templateIntegerBounds(field), serverIntegerBounds(field))
    assert.match(settingsScript, new RegExp(`${field}: form\\.${field}`))
  }
  assert.deepEqual(templateIntegerBounds('requestTimeoutMs'), [1_000, 30_000])
  assert.deepEqual(templateIntegerBounds('maxResponseBytes'), [1_024, 1_048_576])
})

test('GET secrets cannot enter DOM state or PATCH payload, while masked status remains visible', () => {
  const forbiddenGetSecrets = ['apiKeyCiphertext', 'apiKeyNonce', 'apiKeyAuthTag', 'apiKeyVersion', 'apiKeyKeyId', 'systemPrompt']
  const applyResponse = extractFunction('applySettingsResponse', 'buildPatchPayload')
  for (const field of forbiddenGetSecrets) assert.doesNotMatch(applyResponse, new RegExp(`value\\.${field}\\b`))

  assert.doesNotMatch(settingsTemplate, /metadata\.(?:apiKeyCiphertext|apiKeyNonce|apiKeyAuthTag|apiKeyVersion|apiKeyKeyId)|v-html/)
  assert.doesNotMatch(settingsTemplate, /:value="metadata\.apiKeyMasked"|v-model="metadata\./)
  assert.match(settingsTemplate, /autocomplete="new-password"/)
  assert.match(settingsTemplate, /Đang cấu hình \$\{metadata\.apiKeyMasked \|\| '••••'\}/)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const layoutPath = new URL('../app/layouts/default.vue', import.meta.url)
const source = await readFile(layoutPath, 'utf8')
const descriptor = parse(source, { filename: 'default.vue' })
const template = descriptor.descriptor.template?.content ?? ''
const script = descriptor.descriptor.scriptSetup?.content ?? ''

test('public widget SFC parses and uses API-backed quick questions only', () => {
  assert.equal(descriptor.errors.length, 0)
  assert.match(script, /fetch\('\/api\/public\/chatbot\/quick-questions'/)
  assert.match(template, /v-for="question in quickQuestions"/)
  assert.match(template, /:key="question\.id"/)
  assert.match(template, /\{\{ question\.question \}\}/)
  assert.doesNotMatch(source, /botTeasers|chatbotFaqs|Hạn mức vay vốn\?|Làm sao xóa án tích\?|Đăng ký học nghề\?/)
  assert.doesNotMatch(source, /Người hoàn lương được vay vốn tối đa bao nhiêu|Thủ tục xóa án tích như thế nào|Làm thế nào để đăng ký học nghề/)
})

test('quick-question loading, error, empty, success, and retry states are explicit', () => {
  for (const state of ['loading', 'error', 'empty']) {
    assert.match(script, new RegExp(`quickQuestionState\\.value = ['"]${state}['"]|quickQuestionState\\.value === ['"]${state}['"]`))
  }
  assert.match(source, /quickQuestionState(?:\.value)? === ['"]success['"]|\? ['"]success['"] : ['"]empty['"]/)
  assert.match(script, /Đang tải câu hỏi đã được phê duyệt/)
  assert.match(script, /Hiện không thể tải câu hỏi gợi ý/)
  assert.match(script, /Hiện chưa có câu hỏi gợi ý đã được phê duyệt/)
  // Retry is no longer a separate button: reopening the panel re-fetches the
  // quick questions whenever the previous attempt errored or came back empty.
  assert.match(script, /quickQuestionState\.value === 'error' \|\| quickQuestionState\.value === 'empty'\) loadQuickQuestions\(\)/)
  assert.match(script, /maxQuickQuestions: 8/)
  assert.match(script, /data\?\.ok === true && data\?\.available === true && items\.length > 0/)
})

test('governed SSE endpoint and response metadata drive public status rendering', () => {
  assert.match(script, /fetch\('\/api\/public\/chatbot'/)
  assert.doesNotMatch(script, /fetch\('\/api\/chat'/)
  assert.match(script, /Accept: 'text\/event-stream'/)
  assert.match(script, /data\?\.chatbot/)
  for (const kind of ['curated', 'provider', 'not_found', 'unavailable', 'rate_limited']) {
    assert.match(script, new RegExp(`['"]${kind}['"]`))
  }
  assert.match(template, /messageKindLabel\(msg\.kind\)/)
  assert.match(template, /msg\.sources\?\.length/)
  assert.match(template, /aria-label="Nguồn tham khảo"/)
})

test('public source rendering is allowlisted and only permits HTTPS links', () => {
  assert.match(script, /url\.protocol === 'https:'/)
  assert.match(script, /rawSource\.label/)
  assert.match(script, /rawSource\.reference/)
  assert.match(script, /maxSources: 3/)
  assert.match(template, /v-if="source\.url"/)
  assert.match(template, /rel="noopener noreferrer"/)
  assert.match(template, /\{\{ source\.label \}\}/)
  assert.match(template, /\{\{ source\.reference \}\}/)
  assert.doesNotMatch(template, /v-html/)
  assert.doesNotMatch(script, /renderMarkdown/)
})

test('client submission is bounded, single-flight, abortable, and preserves failed input', () => {
  assert.match(script, /maxMessageChars: 2000/)
  assert.match(script, /maxHistoryMessages: 8/)
  assert.match(script, /maxTotalUserChars: 30000/)
  assert.match(template, /:maxlength="CHATBOT_CLIENT_LIMITS\.maxMessageChars"/)
  assert.match(template, /:disabled="isSubmitting \|\| !botInput\.trim\(\)"/)
  assert.match(script, /if \(isSubmitting\.value\) return/)
  assert.match(script, /slice\(-CHATBOT_CLIENT_LIMITS\.maxHistoryMessages\)/)
  assert.match(script, /signal: requestController\.signal/)
  assert.match(script, /chatRequestController\?\.abort\(\)/)
  assert.match(script, /botInput\.value = text/)
  assert.match(script, /if \(succeeded\) \{\s*botInput\.value = ''/s)
})

test('widget exposes accessible status, focus, reduced-motion, and mobile-safe controls', () => {
  assert.match(template, /role="dialog"/)
  assert.match(template, /aria-modal="true"/)
  assert.match(template, /aria-live="polite"/)
  assert.match(template, /role="status"/)
  assert.match(template, /role="alert"/)
  assert.match(template, /focus-visible:ring-2/)
  assert.match(template, /motion-reduce:/)
  // A fallback value is supplied: env(safe-area-inset-bottom, 0px).
  assert.match(template, /env\(safe-area-inset-bottom\s*[,)]/)
  assert.match(script, /event\.key !== 'Tab'/)
  assert.match(script, /chatToggleButton\.value\?\.focus\(\)/)
})

test('public widget contains no provider settings, secrets, internals, or raw errors', () => {
  const forbidden = [
    'apiKey',
    'systemPrompt',
    'internalNotes',
    'allowedHosts',
    'Authorization',
    'ciphertext',
    'providerPolicy',
    'raw upstream',
  ]
  for (const marker of forbidden) assert.doesNotMatch(source, new RegExp(marker, 'i'))
  assert.doesNotMatch(script, /console\.(?:error|log)\(/)
  assert.doesNotMatch(script, /targetFullText \+= jsonStr/)
})

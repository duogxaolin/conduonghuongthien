import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

// The widget was extracted out of `app/layouts/default.vue` so that the full-page
// assistant at `/assistant` could render the same conversation without duplicating
// it: markup now lives in `ChatWidget.vue` and the logic in `useChatbot.ts`.
//
// Every contract below is about the public widget's *behaviour*, not about which
// file holds a given line, so `script` spans both halves. Splitting the
// assertions by file would make a future move of one function look like a
// regression.
const widgetPath = new URL('../app/components/ChatWidget.vue', import.meta.url)
const composablePath = new URL('../app/composables/useChatbot.ts', import.meta.url)
const widgetSource = await readFile(widgetPath, 'utf8')
const composableSource = await readFile(composablePath, 'utf8')

const descriptor = parse(widgetSource, { filename: 'ChatWidget.vue' })
const template = descriptor.descriptor.template?.content ?? ''
const script = `${descriptor.descriptor.scriptSetup?.content ?? ''}\n${composableSource}`
const source = `${widgetSource}\n${composableSource}`

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
  // The bound must come from the shared constant, whether it is referenced
  // directly or through the composable's `limits` alias — what matters is that
  // it is not a second hardcoded number that can drift from the server's.
  assert.match(template, /:maxlength="(?:CHATBOT_CLIENT_LIMITS|limits)\.maxMessageChars"/)
  assert.match(template, /:disabled="isSubmitting \|\| !botInput\.trim\(\)"/)
  assert.match(script, /if \(isSubmitting\.value\) return/)
  assert.match(script, /slice\(-CHATBOT_CLIENT_LIMITS\.maxHistoryMessages\)/)
  assert.match(script, /signal: requestController\.signal/)
  // An in-flight request must be cancellable. The guard style — optional
  // chaining or a plain if — is not the contract.
  assert.match(script, /chatRequestController(?:\?)?\.abort\(\)/)
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

test('the panel grows on tablet and desktop without escaping the viewport', () => {
  const dialog = template.match(/id="public-chatbot-dialog"[\s\S]*?\n\s*>/)?.[0] ?? ''
  assert.ok(dialog, 'the dialog element must be findable')

  // Phones stay full-screen; the floating panel only starts at md.
  assert.match(dialog, /w-screen h-\[100dvh\]/)

  // Both breakpoints cap against the viewport rather than naming a fixed size,
  // so a short window or a narrow tablet cannot push the panel off screen.
  const widths = [...dialog.matchAll(/\b(md|lg):w-\[([^\]]+)\]/g)].map(match => match[2])
  const heights = [...dialog.matchAll(/\b(md|lg):h-\[([^\]]+)\]/g)].map(match => match[2])
  assert.equal(widths.length, 2, 'the panel must set a width at md and again at lg')
  assert.equal(heights.length, 2, 'the panel must set a height at md and again at lg')
  for (const height of heights) assert.match(height, /min\(.*100dvh/, `height ${height} must clamp to the viewport`)
  assert.ok(
    widths.some(width => /min\(.*100vw/.test(width)),
    'the md width must clamp to the viewport for narrow tablets',
  )
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

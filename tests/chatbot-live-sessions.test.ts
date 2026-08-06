import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { issueSessionToken, verifySessionToken } from '../server/utils/chatbot/session-token'
import { normalizeVietnamesePhone, detectPhone, detectName } from '../server/utils/chatbot/contact-detect'
import { summarizeUserAgent } from '../server/utils/chatbot/user-agent'

const SECRET = 'test-secret-not-a-real-key-0123456789abcdef'

// ─── 10.1 Session token ───────────────────────────────────────────────────────
// The signature buys exactly one thing: nobody can write chat rows under an
// arbitrary or guessed session id. These tests pin that boundary.

test('issueSessionToken mints a uuid.hmac pair that verifies against the same secret', () => {
  const { sessionId, token } = issueSessionToken(SECRET)
  const [uuid, mac] = token.split('.')
  assert.equal(uuid, sessionId, 'the returned id is the id embedded in the token')
  assert.equal(uuid?.length, 36, 'uuid half is a v4 uuid')
  assert.equal(mac?.length, 32, 'hmac half is truncated to 32 hex chars')
  assert.equal(verifySessionToken(token, SECRET), sessionId)
})

test('issueSessionToken never repeats a session id', () => {
  const ids = new Set(Array.from({ length: 50 }, () => issueSessionToken(SECRET).sessionId))
  assert.equal(ids.size, 50)
})

test('verifySessionToken rejects a tampered signature', () => {
  const { sessionId, token } = issueSessionToken(SECRET)
  const mac = token.split('.')[1]!
  // Flip one hex digit: still well-formed, still the right length.
  const flipped = (mac[0] === 'a' ? 'b' : 'a') + mac.slice(1)
  assert.equal(verifySessionToken(`${sessionId}.${flipped}`, SECRET), null)
})

test('verifySessionToken rejects a signature made with a different secret', () => {
  const { token } = issueSessionToken(SECRET)
  assert.equal(verifySessionToken(token, `${SECRET}-other`), null)
})

test('verifySessionToken rejects a uuid with no signature at all', () => {
  const { sessionId } = issueSessionToken(SECRET)
  assert.equal(verifySessionToken(sessionId, SECRET), null, 'bare uuid is not a token')
})

test('verifySessionToken rejects a valid-looking token when no secret is configured', () => {
  // Without a secret nothing can be verified, and treating that as "trusted"
  // would let anyone write under any id.
  const { token } = issueSessionToken(SECRET)
  assert.equal(verifySessionToken(token, ''), null)
})

test('verifySessionToken returns null for a missing or malformed header instead of throwing', () => {
  // A visitor with no header loses only their own transcript; the reply must
  // still be produced, so this path can never be fatal.
  for (const bad of [undefined, '', '   ', '.', 'not-a-token', 'a'.repeat(200), `${'x'.repeat(36)}.${'y'.repeat(32)}`]) {
    assert.equal(verifySessionToken(bad as any, SECRET), null, `rejected: ${String(bad).slice(0, 20)}`)
  }
})

// ─── 10.3 Vietnamese phone detection ──────────────────────────────────────────

test('normalizeVietnamesePhone accepts every common way of writing a mobile number', () => {
  const expected = '0903480985'
  for (const raw of ['0903480985', '0903 480 985', '0903.480.985', '0903-480-985', '+84903480985', '84903480985', '0084903480985']) {
    assert.equal(normalizeVietnamesePhone(raw), expected, `normalized: ${raw}`)
  }
})

test('normalizeVietnamesePhone rejects non-mobile and malformed numbers', () => {
  for (const raw of [
    '02838221234',  // landline prefix — deliberately out of scope
    '090348098',    // 9 digits
    '09034809855',  // 11 digits
    '0123456789',   // 01x is not an allocated mobile prefix
    'not a number',
    '',
  ]) {
    assert.equal(normalizeVietnamesePhone(raw), null, `rejected: ${raw}`)
  }
})

test('detectPhone finds a number embedded in a sentence', () => {
  assert.equal(detectPhone('anh gọi lại giúp em số 0912 345 678 nhé'), '0912345678')
  assert.equal(detectPhone('sdt: +84987654321'), '0987654321')
  assert.equal(detectPhone('tôi muốn hỏi về thủ tục xin việc'), null)
})

test('detectPhone does not mistake a long digit run for a phone number', () => {
  // A citizen id or a decree number must not be filed as a contact number.
  assert.equal(detectPhone('theo nghị định 49/2020/NĐ-CP'), null)
  assert.equal(detectPhone('số căn cước 001199012345'), null)
})

test('detectName only fires on an explicit Vietnamese introduction', () => {
  assert.equal(detectName('tôi tên Nguyễn Văn A'), 'Nguyễn Văn A')
  assert.equal(detectName('em là Trần Thị B ạ'), 'Trần Thị B')
  // No introduction verb: a question that happens to contain a proper noun is
  // not a self-identification.
  assert.equal(detectName('thủ tục ở Hà Nội thế nào'), null)
  assert.equal(detectName(''), null)
})

test('detectName rejects a run of words too long to be a name', () => {
  assert.equal(detectName('tôi tên là người vừa mới ra tù muốn xin giấy tờ đi làm lại'), null)
})

// ─── User-agent summary ───────────────────────────────────────────────────────

test('summarizeUserAgent picks the specific browser, not the Chrome/Safari it also claims', () => {
  assert.equal(
    summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'),
    'Edge · Windows',
  )
  assert.equal(
    summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),
    'Safari · iPhone',
  )
  assert.equal(summarizeUserAgent('curl/8.4.0'), 'Công cụ dòng lệnh')
})

test('summarizeUserAgent keeps an unrecognised agent visible rather than hiding it', () => {
  assert.equal(summarizeUserAgent(''), 'Không rõ')
  assert.equal(summarizeUserAgent(null), 'Không rõ')
  assert.equal(summarizeUserAgent('SomeUnknownClient/1.0'), 'SomeUnknownClient/1.0')
})

// ─── 10.2 Typewriter playback ─────────────────────────────────────────────────
// The composable imports Vue and Nuxt auto-imports, so it cannot be loaded in a
// bare Node test. The word-splitting rule is the part that can silently corrupt
// content, so it is re-derived here and pinned against the source text.

const COMPOSABLE = readFileSync('app/composables/useChatbot.ts', 'utf8')
// Playback moved into its own module — the composable had grown to 939 lines and
// this block reads nothing from the conversation state, so it is testable on its
// own. `useChatbot` re-exports it, so every call site kept one import path.
const TYPEWRITER = readFileSync('app/composables/useChatbotTypewriter.ts', 'utf8')

test('playTypewriter splits with a separator-preserving pattern', () => {
  // `split(' ')` would collapse newlines and double spaces, quietly reformatting
  // legal text on its way to the screen. The match keeps the trailing
  // whitespace with each chunk so the reassembly is byte-identical.
  assert.match(TYPEWRITER, /match\(\/\\S\+\\s\*\/g\)/, 'uses /\\S+\\s*/g')
  assert.doesNotMatch(TYPEWRITER, /fullText\.split\(' '\)/, 'never a naive space split')
})

test('the separator-preserving split reassembles legal text byte for byte', () => {
  const samples = [
    'Theo Điều 4 Nghị định 49/2020/NĐ-CP:\n\n- Điểm a: nội dung.\n- Điểm b:  hai dấu cách.',
    'Một câu bình thường.',
    '  câu bắt đầu bằng dấu cách',
  ]
  for (const text of samples) {
    const chunks = text.match(/\S+\s*/g) ?? []
    // Leading whitespace is the one thing the pattern drops, so compare against
    // the trimmed-start original — which is what the visitor should see anyway.
    assert.equal(chunks.join(''), text.replace(/^\s+/, ''), `reassembled: ${JSON.stringify(text.slice(0, 24))}`)
  }
})

test('playTypewriter honours prefers-reduced-motion and a zero delay', () => {
  assert.match(TYPEWRITER, /prefers-reduced-motion/, 'checks the media query')
  // Both shortcuts must exist: the OS setting, and an explicit delayMs === 0
  // for callers that want the text now (e.g. restoring a persisted message).
  assert.match(TYPEWRITER, /delayMs\s*(?:===|<=)\s*0/, 'has an instant path')
})

test('persisted conversations never include a half-typed message', () => {
  // Reloading mid-animation would restore a sentence cut off in the middle and
  // there would be nothing left to finish it.
  assert.match(COMPOSABLE, /isStreaming/, 'tracks the streaming flag')
  assert.match(
    COMPOSABLE,
    /function persist[\s\S]{0,900}isStreaming/,
    'persist() filters on isStreaming',
  )
})

test('the client asks the server for a session token instead of signing one', () => {
  // A browser that could sign its own ids would need the secret, and then the
  // signature would prove nothing.
  assert.match(COMPOSABLE, /\/api\/public\/chatbot\/session/, 'mints via the server endpoint')
  assert.doesNotMatch(COMPOSABLE, /ANALYTICS_HMAC_SECRET/, 'the secret never reaches the client')
  assert.match(COMPOSABLE, /X-Chat-Session/, 'sends the token back as a header')
})

test('the widget ships a honeypot field and the server treats a filled one as a bot', () => {
  const widget = readFileSync('app/components/ChatWidget.vue', 'utf8')
  assert.match(widget, /name="_h"/, 'honeypot input present')
  assert.match(widget, /tabindex="-1"/, 'kept out of the tab order')

  const handler = readFileSync('server/api/public/chatbot/index.post.ts', 'utf8')
  // Answering 200 with a plausible reply is the point: a 400 or 403 would tell
  // the script exactly which field gave it away.
  assert.match(handler, /_h\b/, 'handler reads the honeypot field')
  assert.doesNotMatch(
    handler.slice(0, handler.indexOf('validateChatRequestBody')),
    /statusCode:\s*4\d\d/,
    'the honeypot branch does not answer with a 4xx',
  )
})

// ─── Storage / persistence contracts ──────────────────────────────────────────

test('chat persistence failure can never break the visitor reply', () => {
  const sessionDb = readFileSync('server/utils/chatbot/session-db.ts', 'utf8')
  assert.match(sessionDb, /try\s*\{/, 'wrapped in try/catch')
  assert.match(sessionDb, /chat_session\.persist_failed/, 'logs the failure instead of throwing')
})

test('the session upsert leaves started_at alone', () => {
  const sessionDb = readFileSync('server/utils/chatbot/session-db.ts', 'utf8')
  const start = sessionDb.indexOf('ON DUPLICATE KEY UPDATE')
  assert.ok(start > 0, 'the upsert exists')
  // The query is a template literal whose inner backticks are escaped, so the
  // clause ends at the first *unescaped* backtick after this point.
  const rest = sessionDb.slice(start)
  const end = rest.search(/[^\\]`/)
  const clause = rest.slice(0, end + 1).replace(/\\`/g, '')
  assert.doesNotMatch(clause, /started_at/, 'a session starts once; the update must not move it')
  assert.match(clause, /message_count\s*=\s*message_count\s*\+\s*1/, 'counts up rather than overwriting')
})

test('detected contact fields accumulate instead of overwriting each other', () => {
  // A name given in turn 2 and a phone given in turn 5 must both survive; a
  // plain assignment would blank whichever the current turn did not contain.
  const sessionDb = readFileSync('server/utils/chatbot/session-db.ts', 'utf8')
  assert.match(sessionDb, /COALESCE/, 'uses COALESCE to keep an earlier value')
})

// ─── Admin viewer contracts ───────────────────────────────────────────────────

test('both admin session endpoints require chatbot_knowledge.read and audit the read', () => {
  for (const file of [
    'server/api/admin/chatbot/sessions/index.get.ts',
    'server/api/admin/chatbot/sessions/[id].get.ts',
  ]) {
    const src = readFileSync(file, 'utf8')
    assert.match(src, /requireResourcePermission\(admin,\s*'chatbot_knowledge',\s*'read'\)/, `${file}: permission gate`)
    // Reading transcripts that carry IPs and phone numbers must leave a trace;
    // a log that can be swept silently is a surveillance tool.
    assert.match(src, /insert\(activityLogs\)/, `${file}: writes an audit row`)
    assert.match(src, /getClientIp\(event\)/, `${file}: records the admin's own IP`)
  }
})

test('the session list rejects an unrecognised hasContact value rather than ignoring it', () => {
  // A silent fallback would render an unfiltered list while the control still
  // reads "Đã có số điện thoại".
  const src = readFileSync('server/api/admin/chatbot/sessions/index.get.ts', 'utf8')
  assert.match(src, /hasContact[\s\S]{0,400}statusCode:\s*400/, 'refuses a bad filter value')
})

test('the transcript is ordered oldest-first with a stable tie-break', () => {
  const src = readFileSync('server/api/admin/chatbot/sessions/[id].get.ts', 'utf8')
  assert.match(
    src,
    /orderBy\(asc\(chatMessages\.createdAt\),\s*asc\(chatMessages\.id\)\)/,
    'both turns of one exchange share a timestamp, so id breaks the tie',
  )
})

test('the AI quota is charged per session at the provider call, not per request', () => {
  const policy = readFileSync('server/utils/chatbot/chat-policy.ts', 'utf8')
  assert.match(policy, /chat-ai:\$\{sessionId\}/, 'quota key is the session')
  // Charging at the top of the handler would spend a visitor's allowance on
  // curated answers that never reach a provider.
  assert.match(policy, /enforceAiQuota/, 'quota helper exists')
  const durable = /recordRateLimitHit/
  assert.match(policy, durable, 'counts through the durable store, not a local Map')
  assert.doesNotMatch(policy, /new Map\(\)[\s\S]{0,40}rateBucket/i, 'the in-process bucket is gone')
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { mock } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { createSseHeartbeat, SSE_HEARTBEAT_FRAME, SSE_HEARTBEAT_INTERVAL_MS } from '../server/utils/chatbot/sse-heartbeat'
import { SLOW_WAIT_THRESHOLD_MS, useSlowWait } from '../app/composables/useSlowWait'
import { parseSseLine } from '../app/composables/useChatbot'
import { chatSurfaceSource, chatSurfaceTemplate } from './_component-family.ts'

/**
 * The AI provider can take 40–200 seconds for one answer. Two things go wrong while
 * the visitor waits for the first word: a proxy with a default 60s read timeout cuts
 * the connection (nothing is on the wire), and the visitor sees "Đang suy nghĩ…"
 * with no sign that this wait is longer than normal. The server now sends an SSE
 * comment every 15 seconds until the first text arrives, and the widget says so
 * after 20 seconds. The call itself is never cancelled — that was the decision.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// ─── Server: heartbeat ───────────────────────────────────────────────────────

test('the heartbeat is an SSE comment the client parser ignores', () => {
  assert.equal(SSE_HEARTBEAT_FRAME, ': ping\n\n')
  const target = { text: '', message: { id: 'bot-1', sender: 'bot', text: '' } as never }
  parseSseLine(SSE_HEARTBEAT_FRAME.trim(), target)
  assert.equal(target.text, '', 'a comment line must not become answer text')
})

test('pings are sent on the interval and not before', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    const frames: string[] = []
    const heartbeat = createSseHeartbeat(frame => frames.push(frame))
    heartbeat.start()
    mock.timers.tick(SSE_HEARTBEAT_INTERVAL_MS - 1)
    assert.equal(frames.length, 0)
    mock.timers.tick(1)
    assert.deepEqual(frames, [SSE_HEARTBEAT_FRAME])
    mock.timers.tick(SSE_HEARTBEAT_INTERVAL_MS * 2)
    assert.equal(frames.length, 3)
    heartbeat.stop()
  } finally { mock.timers.reset() }
})

test('after stop() nothing more is written — not even a ping already due', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    const frames: string[] = []
    const heartbeat = createSseHeartbeat(frame => frames.push(frame))
    heartbeat.start()
    mock.timers.tick(SSE_HEARTBEAT_INTERVAL_MS)
    heartbeat.stop()
    heartbeat.stop() // idempotent: the first text chunk and the finally both call it
    mock.timers.tick(SSE_HEARTBEAT_INTERVAL_MS * 5)
    assert.equal(frames.length, 1)
  } finally { mock.timers.reset() }
})

test('a write to a closed connection stops the heartbeat instead of throwing forever', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    let calls = 0
    const heartbeat = createSseHeartbeat(() => { calls += 1; throw new Error('write after end') })
    heartbeat.start()
    assert.doesNotThrow(() => mock.timers.tick(SSE_HEARTBEAT_INTERVAL_MS * 4))
    assert.equal(calls, 1, 'one failed write ends it')
  } finally { mock.timers.reset() }
})

test('start() twice does not double the pings', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    const frames: string[] = []
    const heartbeat = createSseHeartbeat(frame => frames.push(frame))
    heartbeat.start()
    heartbeat.start()
    mock.timers.tick(SSE_HEARTBEAT_INTERVAL_MS)
    assert.equal(frames.length, 1)
    heartbeat.stop()
  } finally { mock.timers.reset() }
})

test('the interval is well under a 60s proxy read timeout', () => {
  assert.ok(SSE_HEARTBEAT_INTERVAL_MS <= 20_000)
})

test('the endpoint heartbeats through every silence and always stops it', () => {
  const source = read('../server/api/public/chatbot/index.post.ts')
  assert.match(source, /createSseHeartbeat\(/)
  assert.match(source, /heartbeat\.start\(\)/)
  // Each chunk of text resets the count (stop, write, start) — a ping goes only after 15 s of silence…
  // (inside the chunk callback itself: the match may not run on past its closing `},` into the next callback)
  assert.match(source, /\(delta: string\) => \{\s*heartbeat\.stop\(\)(?:(?!\},)[\s\S])*?heartbeat\.start\(\)\s*\},/)
  // …and on every other way out (error, empty answer), before the stream ends.
  assert.match(source, /finally \{\s*heartbeat\.stop\(\)/)
})

// ─── Client: "waiting longer than usual" ─────────────────────────────────────

test('the slow-wait flag turns on only after the threshold of continuous waiting', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const scope = effectScope()
    const waiting = ref(false)
    const slow = scope.run(() => useSlowWait(waiting))!
    assert.equal(slow.value, false)
    waiting.value = true
    await nextTick()
    mock.timers.tick(SLOW_WAIT_THRESHOLD_MS - 1)
    assert.equal(slow.value, false)
    mock.timers.tick(1)
    assert.equal(slow.value, true)
    scope.stop()
  } finally { mock.timers.reset() }
})

test('the first word clears the flag and a new question starts the count over', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const scope = effectScope()
    const waiting = ref(true)
    const slow = scope.run(() => useSlowWait(waiting))!
    mock.timers.tick(SLOW_WAIT_THRESHOLD_MS)
    assert.equal(slow.value, true)
    waiting.value = false
    await nextTick()
    assert.equal(slow.value, false)
    waiting.value = true
    await nextTick()
    mock.timers.tick(SLOW_WAIT_THRESHOLD_MS - 1)
    assert.equal(slow.value, false, 'the earlier wait must not carry over')
    scope.stop()
  } finally { mock.timers.reset() }
})

test('disposing the scope cancels the pending timer', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const scope = effectScope()
    const waiting = ref(true)
    const slow = scope.run(() => useSlowWait(waiting))!
    scope.stop()
    mock.timers.tick(SLOW_WAIT_THRESHOLD_MS * 2)
    assert.equal(slow.value, false)
  } finally { mock.timers.reset() }
})

test('both surfaces say so inside the existing status region, without losing the screen-reader label', () => {
  // The widget is read as its whole family since its wave3 split (tests/_component-family.ts).
  for (const file of ['../app/components/ChatWidget.vue', '../app/pages/assistant.vue']) {
    const source = chatSurfaceSource(file)
    const template = chatSurfaceTemplate(file)
    assert.match(source, /useSlowWait\(isAwaitingFirstWord\)/, `${file} must track the wait`)
    const block = template.match(/v-if="isAwaitingFirstWord"[\s\S]{0,3500}/)?.[0] ?? ''
    assert.match(block, /role="status"/, `${file}: the indicator must stay a status region`)
    assert.match(block, /Trợ lý đang soạn/, `${file}: the original screen-reader label stays`)
    assert.match(block, /v-if="isSlowWait"[^>]*>[\s\S]*?Đang chờ lâu hơn bình thường/, `${file}: the slow-wait line`)
  }
})

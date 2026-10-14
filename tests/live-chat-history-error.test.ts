import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * `useLiveChat`: lượt đọc lịch sử phòng chat HỎNG từng bị nuốt im lặng — phòng hiện
 * "Chưa có tin nhắn. Hãy gửi câu đầu tiên!" dù thật ra có cả chục tin trước đó (máy
 * chủ nay trả 503 khi CSDL rơi). Nay: `historyError` + `retryHistory()` (chỉ đọc lại
 * lịch sử, không mở lại stream); stream vẫn chạy và tin mới vẫn vào.
 *
 * Chạy composable thật với `EventSource` + `$fetch` giả.
 */

type Listener = (ev: { data: string }) => void

class FakeEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  closed = false
  onerror: (() => void) | null = null
  private listeners = new Map<string, Listener[]>()
  url: string
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this) }
  addEventListener(name: string, fn: Listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]) }
  close() { this.closed = true; this.readyState = FakeEventSource.CLOSED }
  emit(name: string, data: unknown) { for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data) }) }
}

type HistoryReply = { ok: boolean, sessionId: number | null, messages: Array<{ id: number, displayName: string, content: string, createdAt: string }> }
let historyCalls = 0
let nextHistory: () => Promise<HistoryReply> = async () => ({ ok: true, sessionId: 7, messages: [] })

const globals = globalThis as unknown as Record<string, unknown>
globals.EventSource = FakeEventSource
globals.$fetch = async (url: string) => {
  if (url !== '/api/public/livestream/chat/history') throw new Error(`unexpected ${url}`)
  historyCalls += 1
  return nextHistory()
}

const { useLiveChat, HISTORY_ERROR_MESSAGE } = await import('../app/composables/useLiveChat.ts')

const msg = (id: number, content: string) => ({ id, displayName: 'Khách', content, createdAt: `2026-10-14T08:00:${String(id).padStart(2, '0')}.000Z` })
const unavailable = () => Object.assign(new Error('503'), { statusCode: 503 })

/** Mở phòng: chờ stream được tạo, phát `ready`, rồi chờ lượt đọc lịch sử xong. */
async function open(chat: ReturnType<typeof useLiveChat>) {
  FakeEventSource.instances.length = 0
  const connecting = chat.connect()
  const source = FakeEventSource.instances.at(-1)!
  source.readyState = FakeEventSource.OPEN
  source.emit('ready', { sessionId: 7, title: 'Buổi phát' })
  await connecting
  return source
}

test('lịch sử hỏng (503): có historyError, phòng VẪN mở, stream vẫn nhận tin mới', async () => {
  historyCalls = 0
  nextHistory = async () => { throw unavailable() }
  const chat = useLiveChat()
  const source = await open(chat)
  assert.equal(chat.historyError.value, HISTORY_ERROR_MESSAGE)
  assert.equal(chat.connection.value, 'open')
  assert.equal(chat.liveError.value, '')
  assert.equal(source.closed, false)
  source.emit('message', msg(30, 'tin mới'))
  assert.deepEqual(chat.messages.value.map(m => m.id), [30])
  chat.disconnect()
})

test('máy chủ trả { ok: false }: là lỗi đọc (thử lại được), KHÔNG phải "buổi phát đã thay đổi"', async () => {
  nextHistory = async () => ({ ok: false, sessionId: null, messages: [] })
  const chat = useLiveChat()
  const source = await open(chat)
  assert.equal(chat.historyError.value, HISTORY_ERROR_MESSAGE)
  assert.equal(chat.connection.value, 'open')
  assert.equal(source.closed, false)
  assert.equal(chat.liveError.value, '')
  chat.disconnect()
})

test('Thử lại: chỉ đọc lại lịch sử (không mở stream mới), gộp theo id với tin đã đến, xoá lỗi', async () => {
  historyCalls = 0
  nextHistory = async () => { throw unavailable() }
  const chat = useLiveChat()
  const source = await open(chat)
  source.emit('message', msg(30, 'tin mới'))
  const streams = FakeEventSource.instances.length

  nextHistory = async () => ({ ok: true, sessionId: 7, messages: [msg(10, 'cũ 1'), msg(20, 'cũ 2'), msg(30, 'tin mới')] })
  await chat.retryHistory()
  assert.equal(historyCalls, 2)
  assert.equal(FakeEventSource.instances.length, streams, 'không mở thêm stream')
  assert.equal(chat.historyError.value, '')
  assert.equal(chat.historyLoading.value, false)
  assert.deepEqual(chat.messages.value.map(m => m.id), [10, 20, 30])
  chat.disconnect()
})

test('Thử lại bấm kép khi lượt trước còn bay → chỉ một lượt gọi', async () => {
  historyCalls = 0
  nextHistory = async () => { throw unavailable() }
  const chat = useLiveChat()
  await open(chat)
  let release!: (value: HistoryReply) => void
  nextHistory = () => new Promise(resolve => { release = resolve })
  const first = chat.retryHistory()
  assert.equal(chat.historyLoading.value, true)
  await chat.retryHistory()
  release({ ok: true, sessionId: 7, messages: [msg(1, 'a')] })
  await first
  assert.equal(historyCalls, 2, 'lượt mở phòng + đúng một lượt thử lại')
  assert.equal(chat.historyError.value, '')
  chat.disconnect()
})

test('Thử lại hỏng tiếp → lỗi vẫn hiện; kết quả về muộn sau khi rời phòng bị bỏ', async () => {
  nextHistory = async () => { throw unavailable() }
  const chat = useLiveChat()
  await open(chat)
  await chat.retryHistory()
  assert.equal(chat.historyError.value, HISTORY_ERROR_MESSAGE)

  let release!: (value: HistoryReply) => void
  nextHistory = () => new Promise(resolve => { release = resolve })
  const late = chat.retryHistory()
  chat.disconnect()
  release({ ok: true, sessionId: 7, messages: [msg(5, 'muộn')] })
  await late
  assert.deepEqual(chat.messages.value, [], 'không đắp tin của lượt đã bỏ')
  assert.equal(chat.historyError.value, '', 'rời phòng xoá cảnh báo')
})

test('phiên đổi giữa chừng (sessionId khác) → vẫn đóng phòng như cũ', async () => {
  nextHistory = async () => ({ ok: true, sessionId: 8, messages: [] })
  const chat = useLiveChat()
  const source = await open(chat)
  assert.equal(chat.connection.value, 'closed')
  assert.equal(source.closed, true)
  assert.match(chat.liveError.value, /Buổi phát đã thay đổi/)
  assert.equal(chat.historyError.value, '')
})

test('phòng đã đóng → Thử lại không gọi gì', async () => {
  historyCalls = 0
  const chat = useLiveChat()
  await chat.retryHistory()
  assert.equal(historyCalls, 0)
})

// Hiển thị nằm trong template — phần duy nhất phải đọc chữ.
test('LiveChat.vue: cảnh báo lịch sử là role="alert" + nút Thử lại gọi retryHistory', () => {
  const source = readFileSync(new URL('../app/components/LiveChat.vue', import.meta.url), 'utf8')
  const block = source.match(/<div\s+v-if="historyError && connection === 'open'"[\s\S]*?<\/div>/)
  assert.ok(block, 'thiếu khối cảnh báo lịch sử')
  assert.match(block![0], /role="alert"/)
  assert.match(block![0], /@click="retryHistory"/)
  assert.match(block![0], /:disabled="historyLoading"/)
  assert.match(block![0], /t\('retry'\)/)
  assert.doesNotMatch(source, /location\.reload\(\)/)
  // "Chưa có tin nhắn" không được hiện khi chỉ là lịch sử chưa tải được.
  assert.match(source, /v-if="messages\.length === 0 && connection === 'open' && !historyError"/)
})

/**
 * Process-local SSE registry (one application replica). The native Node transport
 * owns byte limits and respects socket backpressure; this registry additionally
 * limits outstanding messages and owns session/shutdown lifecycle.
 */
import type { EventStreamMessage } from 'h3'
import { SSE_CLOSE_GRACE_MS, SSE_MAX_PENDING } from './node-sse-stream'

export const SSE_EVENT_MESSAGE = 'message'
export const SSE_EVENT_REMOVAL = 'removal'
export const SSE_EVENT_ENDED = 'ended'
export const SSE_EVENT_SHUTDOWN = 'shutdown'
export const SSE_EVENT_READY = 'ready'
export const MAX_PENDING = SSE_MAX_PENDING

/**
 * Toàn cục cap số kết nối SSE đang mở trên một replica. Mỗi connection giữ một
 * socket và một timer heartbeat; không có cap thì một botnet mở hàng nghìn
 * EventSource làm cạn file descriptor / RAM trên VPS 1–2 GB — đúng lúc đang
 * phát trực tiếp, khi cổng cần phục vụ người xem thật. Giới hạn này là biên
 * **cuối cùng**: rate limit per-IP ở endpoint chặn trước, cap này chặn khi
 * attacker quay IP.
 */
export const MAX_STREAMS = 500

export type SseStream = {
  /** Resolves only after transport delivery; rejects on write failure/abort. */
  push(message: EventStreamMessage): Promise<void>
  close(): Promise<void>
  onClosed(cb: () => unknown): void
  /** Immediately destroy a blocked socket. Optional for test/legacy adapters. */
  abort?(): void
}

type Entry = { stream: SseStream; sessionId: number; pending: number; closed: boolean }
const entries = new Map<SseStream, Entry>()
const bySession = new Map<number, Set<SseStream>>()
let shuttingDown = false

export function isShuttingDown(): boolean { return shuttingDown }

export function registerStream(stream: SseStream, sessionId: number): boolean {
  releaseStream(stream)
  if (entries.size >= MAX_STREAMS) {
    // Đạt cap toàn cục: từ chối kết nối mới thay vì nhờ OOM-killer canh.
    // Không abort stream ở đây — nơi gọi chưa push gì, chỉ return false để
    // trả 503 kèm Retry-After.
    return false
  }
  entries.set(stream, { stream, sessionId, pending: 0, closed: false })
  let group = bySession.get(sessionId)
  if (!group) { group = new Set(); bySession.set(sessionId, group) }
  group.add(stream)
  stream.onClosed(() => { releaseStream(stream) })
  return true
}

export function releaseStream(stream: SseStream): void {
  const entry = entries.get(stream)
  if (!entry) return
  entry.closed = true
  entries.delete(stream)
  const group = bySession.get(entry.sessionId)
  group?.delete(stream)
  if (group?.size === 0) bySession.delete(entry.sessionId)
}

export function trackedStreamCount(sessionId?: number): number {
  return sessionId === undefined ? entries.size : (bySession.get(sessionId)?.size ?? 0)
}

function abortStream(stream: SseStream): void {
  releaseStream(stream)
  if (stream.abort) stream.abort()
  else void stream.close().catch(() => undefined)
}

function pushTracked(entry: Entry, message: EventStreamMessage): boolean {
  if (entry.closed) return false
  if (entry.pending >= MAX_PENDING) {
    abortStream(entry.stream)
    return false
  }
  entry.pending++
  try {
    void entry.stream.push(message).then(
      () => { entry.pending-- },
      () => { entry.pending--; abortStream(entry.stream) },
    )
  } catch {
    entry.pending--
    abortStream(entry.stream)
    return false
  }
  return true
}

export function broadcastToSession(sessionId: number, message: EventStreamMessage): number {
  if (shuttingDown) return 0
  let delivered = 0
  for (const stream of [...(bySession.get(sessionId) ?? [])]) {
    const entry = entries.get(stream)
    if (entry && pushTracked(entry, message)) delivered++
  }
  return delivered
}

/** Final delivery has a deadline shared across all readers, never a serial wait. */
async function finishStream(stream: SseStream, message?: EventStreamMessage): Promise<void> {
  releaseStream(stream)
  let timer: ReturnType<typeof setTimeout> | undefined
  const delivery = (async () => {
    if (message) await stream.push(message)
    await stream.close()
  })().catch(() => { abortStream(stream) })
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(() => { abortStream(stream); resolve() }, SSE_CLOSE_GRACE_MS)
  })
  try { await Promise.race([delivery, timeout]) }
  finally { clearTimeout(timer) }
}

export async function closeSessionStreams(sessionId: number, message: EventStreamMessage): Promise<number> {
  const streams = [...(bySession.get(sessionId) ?? [])]
  await Promise.all(streams.map(stream => finishStream(stream, shuttingDown ? undefined : message)))
  return streams.length
}

export async function beginShutdown(message: EventStreamMessage): Promise<number> {
  shuttingDown = true
  const streams = [...entries.keys()]
  await Promise.all(streams.map(stream => finishStream(stream, message)))
  return streams.length
}

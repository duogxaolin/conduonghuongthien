import { setResponseHeaders, setResponseStatus, type EventStreamMessage, type H3Event } from 'h3'

export const SSE_MAX_PENDING = 64
export const SSE_MAX_BUFFERED_BYTES = 64 * 1024
export const SSE_CLOSE_GRACE_MS = 1000
export const SSE_WRITE_TIMEOUT_MS = 15_000
export const SSE_HEARTBEAT_MS = 15_000

type Frame = { data: Buffer; reservation: number; resolve: () => void; reject: (error: Error) => void }
type Options = { heartbeatMs?: number; writeTimeoutMs?: number; closeGraceMs?: number }

/** SSE framing: event/id are single lines, while every data line gets its own prefix. */
function encode(message: EventStreamMessage): Buffer {
  let text = ''
  if (message.id) text += `id: ${message.id.replace(/[\r\n]/g, '')}\n`
  if (message.event) text += `event: ${message.event.replace(/[\r\n]/g, '')}\n`
  if (Number.isInteger(message.retry)) text += `retry: ${message.retry}\n`
  for (const line of (message.data ?? '').split(/\r\n|\r|\n/)) text += `data: ${line}\n`
  return Buffer.from(`${text}\n`)
}

/**
 * Native Node response writer. Unlike H3's WebStream adapter, it waits for both
 * the write callback and `drain` before submitting another frame. The budget
 * reserves two wire copies per frame (application queue and Node/socket queue),
 * including framing overhead. Every push, including ready and heartbeats, is
 * subject to this budget. Slow or failed sockets are destroyed, never awaited
 * indefinitely. `send()` resolves when the connection finishes or is aborted.
 */
export function createNodeSseStream(event: H3Event, options: Options = {}) {
  const response = event.node.res
  const queue: Frame[] = []
  const callbacks = new Set<() => unknown>()
  let active: Frame | undefined
  let reservedBytes = 0
  let started = false
  let ending = false
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let writeDeadline: ReturnType<typeof setTimeout> | undefined
  let resolveDone!: () => void
  const done = new Promise<void>(resolve => { resolveDone = resolve })

  function dispose(error = new Error('SSE connection closed')) {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    clearTimeout(deadline)
    clearTimeout(writeDeadline)
    response.off('drain', drained)
    response.off('finish', finished)
    response.off('close', disconnected)
    // Keep the error listener until close: destroy/write callbacks can report an
    // error after disposal, and an unobserved EventEmitter error would crash Node.
    if (response.closed) response.off('error', failed)
    else response.once('close', () => response.off('error', failed))
    if (active) active.reject(error)
    for (const frame of queue) frame.reject(error)
    active = undefined
    queue.length = 0
    reservedBytes = 0
    for (const callback of callbacks) { try { callback() } catch { /* cleanup is best effort */ } }
    callbacks.clear()
    resolveDone()
  }
  function abort() {
    dispose(new Error('SSE connection exceeded its delivery budget'))
    if (!response.destroyed) response.destroy()
  }
  function failed() { abort() }
  function finished() { dispose() }
  function disconnected() { dispose() }

  let writeFinished = false
  let needsDrain = false
  let writing = false
  function completeFrame() {
    if (closed || writing || !active || !writeFinished || needsDrain) return
    clearTimeout(writeDeadline)
    const frame = active
    active = undefined
    reservedBytes -= frame.reservation
    frame.resolve()
    pump()
  }
  function drained() { needsDrain = false; completeFrame() }
  function pump() {
    if (!started || closed || active) return
    const frame = queue.shift()
    if (!frame) {
      if (ending) response.end()
      return
    }
    active = frame
    writeFinished = false
    writing = true
    writeDeadline = setTimeout(abort, options.writeTimeoutMs ?? SSE_WRITE_TIMEOUT_MS)
    try {
      needsDrain = !response.write(frame.data, (error?: Error | null) => {
        if (error) { abort(); return }
        writeFinished = true
        completeFrame()
      })
    } catch { abort() }
    writing = false
    completeFrame()
  }
  function enqueue(data: Buffer): Promise<void> {
    if (closed || ending) return Promise.reject(new Error('SSE connection is closed'))
    const reservation = 2 * (data.byteLength + 32)
    if (queue.length + Number(Boolean(active)) >= SSE_MAX_PENDING
      || reservedBytes + reservation + response.writableLength > SSE_MAX_BUFFERED_BYTES) {
      abort()
      return Promise.reject(new Error('SSE connection exceeded its delivery budget'))
    }
    reservedBytes += reservation
    return new Promise<void>((resolve, reject) => {
      queue.push({ data, reservation, resolve, reject })
      pump()
    })
  }
  response.on('drain', drained)
  response.on('finish', finished)
  response.on('close', disconnected)
  response.on('error', failed)

  return {
    push(message: EventStreamMessage) { return enqueue(encode(message)) },
    abort,
    onClosed(callback: () => unknown) {
      if (closed) callback()
      else callbacks.add(callback)
    },
    close(): Promise<void> {
      if (!closed && !ending) {
        ending = true
        clearInterval(heartbeat)
        deadline = setTimeout(abort, options.closeGraceMs ?? SSE_CLOSE_GRACE_MS)
        deadline.unref()
        pump()
      }
      return done
    },
    send(): Promise<void> {
      if (started || closed) return done
      started = true
      setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'private, no-cache, no-store, no-transform, must-revalidate, max-age=0',
        'X-Accel-Buffering': 'no',
      })
      setResponseStatus(event, 200)
      event._handled = true
      try { response.flushHeaders() } catch { abort(); return done }
      const interval = options.heartbeatMs ?? SSE_HEARTBEAT_MS
      if (interval > 0 && !ending) {
        heartbeat = setInterval(() => { void enqueue(Buffer.from(': heartbeat\n\n')).catch(abort) }, interval)
        heartbeat.unref()
      }
      pump()
      return done
    },
  }
}

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { Writable } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { test } from 'node:test'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { createNodeSseStream, SSE_MAX_BUFFERED_BYTES } from '../server/utils/node-sse-stream'
import * as registry from '../server/utils/sse-manager'

/** Actual Node Writable buffering, with callbacks deliberately withheld. */
class ProbeResponse extends Writable {
  headers = new Map<string, unknown>()
  headersSent = false
  statusCode = 200
  statusMessage = ''
  socket = new Socket()
  writes = 0
  peakBytes = 0
  chunks: string[] = []
  hold: boolean
  private pendingCallback?: (error?: Error) => void
  constructor(hold = true) { super({ highWaterMark: 1 }); this.hold = hold }
  setHeader(name: string, value: unknown) { this.headers.set(name.toLowerCase(), value); return this }
  getHeader(name: string) { return this.headers.get(name.toLowerCase()) }
  getHeaderNames() { return [...this.headers.keys()] }
  removeHeader(name: string) { this.headers.delete(name.toLowerCase()) }
  flushHeaders() { this.headersSent = true }
  _write(chunk: Buffer, _encoding: string, callback: (error?: Error) => void) {
    this.writes++
    this.chunks.push(chunk.toString())
    if (!this.hold) callback()
    else this.pendingCallback = callback
  }
  _destroy(err: Error | null, callback: (error?: Error | null) => void) {
    if (this.pendingCallback) {
      this.pendingCallback()
      this.pendingCallback = undefined
    }
    callback(err)
  }
  write(...args: any[]): boolean {
    const result = (super.write as any)(...args)
    this.peakBytes = Math.max(this.peakBytes, this.writableLength)
    return result
  }
}

function probe(sessionId: number, response = new ProbeResponse(), options = {}) {
  let transport!: ReturnType<typeof createNodeSseStream>
  const app = createApp()
  app.use(defineEventHandler(event => {
    transport = createNodeSseStream(event, { heartbeatMs: 0, ...options })
    registry.registerStream(transport, sessionId)
    void transport.push({ event: 'ready', data: JSON.stringify({ sessionId }) }).catch(transport.abort)
    return transport.send()
  }))
  const request = new IncomingMessage(new Socket())
  request.url = '/'
  request.method = 'GET'
  const completion = toNodeListener(app)(request, response as any)
  return { response, completion, get transport() { return transport } }
}

test('actual H3 + blocked Node Writable is pruned before socket/queue can grow unbounded', async () => {
  const connection = probe(100)
  await nextTurn()
  for (let index = 0; index < 300; index++) {
    registry.broadcastToSession(100, { event: 'message', data: 'x'.repeat(200) })
    // H3's old WebStream adapter resolves each write on these turns, even though
    // ProbeResponse.write returns false. This test reproduces that exact gap.
    await nextTurn()
  }
  assert.equal(connection.response.writes, 1, 'no second socket write before drain')
  assert.ok(connection.response.peakBytes <= SSE_MAX_BUFFERED_BYTES)
  assert.equal(connection.response.destroyed, true)
  assert.equal(registry.trackedStreamCount(100), 0)
  await connection.completion
})

test('one oversized frame is rejected even with fewer than 64 pending messages', async () => {
  const connection = probe(101)
  await nextTurn()
  await assert.rejects(connection.transport.push({ event: 'message', data: 'x'.repeat(SSE_MAX_BUFFERED_BYTES) }))
  assert.equal(connection.response.writes, 1)
  assert.equal(connection.response.destroyed, true)
  assert.equal(registry.trackedStreamCount(101), 0)
  await connection.completion
})

test('aggregate byte budget closes a blocked reader before the message-count limit', async () => {
  const connection = probe(106)
  await nextTurn()
  let submitted = 0
  while (registry.trackedStreamCount(106) && submitted < 10) {
    registry.broadcastToSession(106, { event: 'message', data: 'x'.repeat(12 * 1024) })
    submitted++
    await nextTurn()
  }
  assert.ok(submitted <= 3, 'combined pending frame bytes must consume the budget')
  assert.equal(connection.response.destroyed, true)
  assert.equal(registry.trackedStreamCount(106), 0)
  assert.ok(connection.response.peakBytes <= SSE_MAX_BUFFERED_BYTES)
  await connection.completion
})

test('stalled idle sockets time out and stop heartbeats without waiting for more broadcasts', { timeout: 2000 }, async () => {
  const connection = probe(102, new ProbeResponse(), { heartbeatMs: 5, writeTimeoutMs: 30 })
  await connection.completion
  assert.equal(connection.response.destroyed, true)
  assert.equal(connection.response.writes, 1)
  assert.equal(registry.trackedStreamCount(102), 0)
})

test('two HTTP readers receive framed messages, ready, and ended before graceful close', { timeout: 5000 }, async t => {
  const app = createApp()
  app.use(defineEventHandler(event => {
    const stream = createNodeSseStream(event, { heartbeatMs: 0 })
    registry.registerStream(stream, 103)
    void stream.push({ event: 'ready', data: '{"sessionId":103}' }).catch(stream.abort)
    return stream.send()
  }))
  const server = createServer(toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const address = server.address() as { port: number }
  const responses = await Promise.all([1, 2].map(() => fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(4000) })))
  for (const response of responses) {
    assert.equal(response.headers.get('content-type'), 'text/event-stream')
    assert.equal(response.headers.get('x-accel-buffering'), 'no')
    assert.match(response.headers.get('cache-control')!, /no-store/)
  }
  const readers = responses.map(response => response.body!.getReader())
  const bodies = await Promise.all(readers.map(async reader => new TextDecoder().decode((await reader.read()).value)))
  assert.equal(registry.trackedStreamCount(103), 2)
  assert.equal(registry.broadcastToSession(103, { event: 'message', id: '42', data: 'line one\nline two' }), 2)
  await registry.closeSessionStreams(103, { event: 'ended', data: 'Buổi phát đã kết thúc.' })
  for (const [index, reader] of readers.entries()) {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bodies[index] += new TextDecoder().decode(chunk.value)
    }
    assert.match(bodies[index]!, /event: ready\ndata: {"sessionId":103}\n\n/)
    assert.match(bodies[index]!, /id: 42\nevent: message\ndata: line one\ndata: line two\n\n/)
    assert.match(bodies[index]!, /event: ended\ndata: Buổi phát đã kết thúc\.\n\n/)
  }
  assert.equal(registry.trackedStreamCount(103), 0)
})

test('disconnect/error drops queued frames, removes registry entry, and settles send', async () => {
  const connection = probe(104)
  await nextTurn()
  registry.broadcastToSession(104, { event: 'message', data: 'queued' })
  connection.response.destroy(new Error('client disconnected'))
  await connection.completion
  assert.equal(registry.trackedStreamCount(104), 0)
  assert.equal(connection.response.writes, 1)
  assert.equal(connection.response.listenerCount('drain'), 0)
  await nextTurn()
  assert.equal(connection.response.listenerCount('error'), 0)
})

// Shutdown is intentionally last: the registry flag is irreversible.
test('shutdown notifies fast readers immediately and aborts blocked readers within one shared grace period', { timeout: 4000 }, async () => {
  const slowA = probe(105)
  const slowB = probe(105)
  const fast = probe(105, new ProbeResponse(false))
  await nextTurn()
  const shutdown = registry.beginShutdown({ event: 'shutdown', data: 'Máy chủ đang khởi động lại.' })
  await nextTurn()
  assert.match(fast.response.chunks.join(''), /event: shutdown/)
  assert.equal(registry.broadcastToSession(105, { data: 'too late' }), 0)
  assert.equal(await shutdown, 3)
  await Promise.all([slowA.completion, slowB.completion, fast.completion])
  assert.equal(slowA.response.destroyed, true)
  assert.equal(slowB.response.destroyed, true)
  assert.equal(registry.trackedStreamCount(), 0)
})

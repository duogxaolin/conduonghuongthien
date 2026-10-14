import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import test from 'node:test'

import { EXPORT_THUMBNAIL_MAX_BYTES, loadOwnThumbnail } from '../server/services/article-export-thumbnail.ts'
import type { ProviderRequest, ResolveProviderHost } from '../server/utils/chatbot/outbound.ts'

/**
 * Ảnh bìa trên R2 khi xuất bài sang Google đi qua `safeProviderRequest`, không qua
 * `fetch` trần.
 *
 * Trước đây: host đúng là host R2 đã cấu hình là đủ — DNS của host đó trỏ về đâu
 * cũng được (10.x, 169.254.169.254, ::1), và thân không có `content-length` được
 * `arrayBuffer()` đọc HẾT vào RAM rồi mới so trần. Các test dưới đây chạy hàm thật
 * với `https.request` giả (cùng seam với `chatbot-outbound-stream.test.ts`).
 */

const R2_PUBLIC = 'https://cdn.example-r2.dev'
const PUBLIC_DNS: ResolveProviderHost = async () => [{ address: '104.18.2.2', family: 4 }]
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

interface Behaviour {
  status?: number
  headers?: Record<string, string>
  /** Body chunks, emitted one per tick. */
  chunks?: Buffer[]
}

function fakeRequest(behaviour: Behaviour, log: { calls: RequestOptions[], destroyed: number, bytesSent: number }): ProviderRequest {
  return ((options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    log.calls.push(options)
    const req = Object.assign(new EventEmitter(), {
      write: () => {},
      destroy: () => {},
      end: () => {
        queueMicrotask(() => {
          const chunks = behaviour.chunks ?? [PNG]
          const source = new Readable({
            read() {
              const next = chunks.shift()
              if (next) { log.bytesSent += next.length; this.push(next) } else this.push(null)
            },
          })
          const response = Object.assign(source, { statusCode: behaviour.status ?? 200, headers: behaviour.headers ?? { 'content-type': 'image/png' } })
          const destroy = response.destroy.bind(response)
          response.destroy = ((error?: Error) => { log.destroyed += 1; return destroy(error) }) as typeof response.destroy
          onResponse(response as unknown as IncomingMessage)
        })
      },
    })
    return req
  }) as unknown as ProviderRequest
}

const newLog = () => ({ calls: [] as RequestOptions[], destroyed: 0, bytesSent: 0 })

test('an R2 image is fetched over a connection pinned to a checked public address', async () => {
  const log = newLog()
  const image = await loadOwnThumbnail('https://CDN.example-r2.dev/2026/10/a.png?v=3#x', R2_PUBLIC, { resolveHost: PUBLIC_DNS, request: fakeRequest({}, log) })
  assert.ok(image)
  assert.equal(image.mimeType, 'image/png')
  assert.equal(image.ext, 'png')
  assert.deepEqual(image.buffer, PNG)
  assert.equal(log.calls.length, 1)
  const options = log.calls[0]!
  assert.equal(options.hostname, 'cdn.example-r2.dev')
  assert.equal(options.servername, 'cdn.example-r2.dev')
  assert.equal(options.port, 443)
  assert.equal(options.path, '/2026/10/a.png', 'query and fragment are dropped')
  assert.equal(options.agent, false, 'no pooled socket that could point elsewhere')
  assert.equal(typeof options.lookup, 'function', 'the checked address is pinned')
})

test('the R2 host resolving to a private or metadata address is never connected to', async () => {
  for (const address of [
    { address: '10.0.0.5', family: 4 as const },
    { address: '169.254.169.254', family: 4 as const },
    { address: '127.0.0.1', family: 4 as const },
    { address: '::1', family: 6 as const },
    { address: 'fd00::1', family: 6 as const },
  ]) {
    const log = newLog()
    const image = await loadOwnThumbnail('https://cdn.example-r2.dev/a.png', R2_PUBLIC, { resolveHost: async () => [address], request: fakeRequest({}, log) })
    assert.equal(image, null, address.address)
    assert.equal(log.calls.length, 0, `no request for ${address.address}`)
  }
})

test('a redirect is not followed', async () => {
  const log = newLog()
  const image = await loadOwnThumbnail('https://cdn.example-r2.dev/a.png', R2_PUBLIC, {
    resolveHost: PUBLIC_DNS,
    request: fakeRequest({ status: 302, headers: { location: 'http://169.254.169.254/' } }, log),
  })
  assert.equal(image, null)
  assert.equal(log.calls.length, 1)
})

test('a body with no content-length is cut off at the cap while it is read', async () => {
  const log = newLog()
  const chunk = Buffer.alloc(1024 * 1024, 1)
  const chunks = Array.from({ length: 64 }, () => chunk) // 64 MiB offered, cap is 10 MiB
  const image = await loadOwnThumbnail('https://cdn.example-r2.dev/huge.png', R2_PUBLIC, {
    resolveHost: PUBLIC_DNS,
    request: fakeRequest({ headers: { 'content-type': 'image/png' }, chunks }, log),
  })
  assert.equal(image, null)
  assert.ok(log.destroyed >= 1, 'the response is destroyed mid-read')
  assert.ok(log.bytesSent < EXPORT_THUMBNAIL_MAX_BYTES + 4 * 1024 * 1024, `reading stopped near the cap (${log.bytesSent} bytes pulled)`)
})

test('a declared content-length over the cap is refused before reading', async () => {
  const log = newLog()
  const image = await loadOwnThumbnail('https://cdn.example-r2.dev/big.png', R2_PUBLIC, {
    resolveHost: PUBLIC_DNS,
    request: fakeRequest({ headers: { 'content-type': 'image/png', 'content-length': String(EXPORT_THUMBNAIL_MAX_BYTES + 1) } }, log),
  })
  assert.equal(image, null)
})

test('non-image responses, error statuses and foreign hosts yield no image', async () => {
  for (const behaviour of [{ headers: { 'content-type': 'text/html' } }, { status: 404 }, { status: 500 }, { chunks: [] as Buffer[] }]) {
    const image = await loadOwnThumbnail('https://cdn.example-r2.dev/a.png', R2_PUBLIC, { resolveHost: PUBLIC_DNS, request: fakeRequest(behaviour, newLog()) })
    assert.equal(image, null, JSON.stringify(behaviour))
  }
  const log = newLog()
  for (const url of ['https://evil.example/a.png', 'http://cdn.example-r2.dev/a.png', 'https://cdn.example-r2.dev:8443/a.png', 'https://cdn.example-r2.dev.evil.example/a.png']) {
    assert.equal(await loadOwnThumbnail(url, R2_PUBLIC, { resolveHost: PUBLIC_DNS, request: fakeRequest({}, log) }), null, url)
  }
  assert.equal(log.calls.length, 0)
})

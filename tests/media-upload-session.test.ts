import assert from 'node:assert/strict'
import test from 'node:test'
import { useMediaUploadSession, mediaFileFingerprint } from '../app/composables/useMediaUploadSession.ts'

const uploadId = '12345678-1234-1234-1234-123456789abc'
const file = () => new File(['abcdef'], 'video.mp4', { type: 'video/mp4', lastModified: 123 })

test('resume fingerprint covers middle bytes without buffering the whole video', async () => {
  const original = new Uint8Array(5 * 1024 * 1024)
  const changed = original.slice()
  changed[2 * 1024 * 1024] = 1
  assert.notEqual(await mediaFileFingerprint(new File([original], 'video.mp4')),
    await mediaFileFingerprint(new File([changed], 'video.mp4')))
})
function harness() {
  const stored = new Map<string, string>()
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) }, removeItem: (key: string) => { stored.delete(key) } }
  const received = new Set<number>()
  const calls: string[] = []
  let failChunk = 1
  let completed = false
  let loseCompletion = false
  let expired = false
  const request = async <T>(url: string, options?: any): Promise<T> => {
    calls.push(url)
    assert.equal(options?.retry, 0)
    if (url.endsWith('/init')) return { uploadId } as T
    if (url.endsWith('/status')) {
      if (expired) throw Object.assign(new Error('gone'), { statusCode: 404 })
      return { session: { uploadId, filename: 'video.mp4', declaredSize: 6, chunkSize: 2, totalChunks: 3,
        receivedParts: [...received], status: completed ? 'completed' : 'uploading', mediaItemId: completed ? 42 : null },
      missing: [0, 1, 2].filter(index => !received.has(index)) } as T
    }
    if (url.includes('/chunk?')) {
      const index = Number(url.split('index=')[1])
      if (index === failChunk) { failChunk = -1; throw new Error('network') }
      assert.equal(new TextDecoder().decode(options.body), ['ab', 'cd', 'ef'][index])
      received.add(index)
      return { receivedParts: [...received] } as T
    }
    completed = true
    if (loseCompletion) throw new Error('response lost')
    return { mediaItemId: 42, slug: 'video' } as T
  }
  const create = (actorId = 7) => useMediaUploadSession({ actorId, storage, request, maxUploadSize: 100 })
  return { create, calls, stored, received, setLoseCompletion: () => { loseCompletion = true; failChunk = -1 }, expire: () => { expired = true } }
}

test('reload resumes the original session and sends only missing chunks after matching the selected file', async () => {
  const h = harness()
  const first = h.create()
  await first.select(file())
  await first.run()
  assert.equal(first.state.phase, 'failed')
  assert.deepEqual([...h.received], [0])
  const restored = h.create()
  assert.equal(restored.state.descriptor?.uploadId, uploadId)
  await restored.run()
  assert.equal(restored.state.phase, 'paused')
  assert.match(restored.state.error, /chọn lại đúng tệp/)
  await restored.select(new File(['xxxxxx'], 'video.mp4', { lastModified: 123 }))
  assert.match(restored.state.error, /không khớp/)
  assert.equal(restored.state.fileName, '')
  await restored.select(file())
  await restored.run()
  assert.equal(restored.state.phase, 'done')
  assert.equal(restored.state.result?.mediaItemId, 42)
  assert.equal(h.calls.filter(call => call.endsWith('/init')).length, 1)
  assert.equal(h.calls.filter(call => call.endsWith('index=0')).length, 1)
  assert.equal(h.stored.size, 0)
})

test('a lost completion response is recovered from status without a new session or another completion', async () => {
  const h = harness()
  h.setLoseCompletion()
  const first = h.create()
  await first.select(file())
  await first.run()
  assert.equal(first.state.phase, 'failed')
  const restored = h.create()
  await restored.run()
  assert.equal(restored.state.phase, 'done')
  assert.equal(restored.state.result?.mediaItemId, 42)
  assert.equal(h.calls.filter(call => call.endsWith('/complete')).length, 1)
  assert.equal(h.calls.filter(call => call.endsWith('/init')).length, 1)
})

test('retry of an expired session never silently creates a replacement and storage is scoped to the actor', async () => {
  const h = harness()
  const first = h.create()
  await first.select(file())
  await first.run()
  assert.equal(h.create(8).state.descriptor, null)
  h.expire()
  const restored = h.create()
  await restored.select(file())
  await restored.run()
  await restored.run()
  assert.equal(restored.state.phase, 'failed')
  assert.match(restored.state.error, /không còn khả dụng/)
  assert.equal(h.calls.filter(call => call.endsWith('/init')).length, 1)
  restored.discard()
  assert.equal(h.create().state.descriptor, null)
})

test('unmount/pause aborts in-flight requests while keeping the resumable descriptor', async () => {
  const h = harness()
  const first = h.create()
  await first.select(file())
  await first.run()
  let signal: AbortSignal | undefined
  const resumed = useMediaUploadSession({ actorId: 7, storage: {
    getItem: key => h.stored.get(key) ?? null, setItem: () => {}, removeItem: () => {},
  }, maxUploadSize: 100, request: (_url, options) => new Promise((_resolve, reject) => {
    signal = options?.signal
    signal?.addEventListener('abort', () => reject(new Error('aborted')))
  }) })
  const pending = resumed.run()
  resumed.pause()
  await pending
  assert.equal(signal?.aborted, true)
  assert.equal(resumed.state.phase, 'paused')
  assert.equal(resumed.state.descriptor?.uploadId, uploadId)
})

test('assembling retries completion after 409 without resending chunks or creating a session', async () => {
  const h = harness()
  const first = h.create()
  await first.select(file())
  await first.run()
  const calls: string[] = []
  let waits = 0
  let completions = 0
  const resumed = useMediaUploadSession({ actorId: 7, storage: {
    getItem: key => h.stored.get(key) ?? null, setItem: () => {}, removeItem: () => {},
  }, maxUploadSize: 100, waitForAssembly: async () => { waits++ },
  request: async <T>(url: string): Promise<T> => {
    calls.push(url)
    if (url.endsWith('/complete')) {
      completions++
      if (completions === 1) throw Object.assign(new Error('busy'), { statusCode: 409 })
      return { mediaItemId: 42, slug: 'video' } as T
    }
    return { session: { status: 'assembling', mediaItemId: null, totalChunks: 3, receivedParts: [0, 1, 2] }, missing: [] } as T
  } })
  await resumed.run()
  assert.equal(resumed.state.phase, 'done')
  assert.equal(waits, 1)
  assert.equal(completions, 2)
  assert.equal(calls.some(url => url.includes('/init') || url.includes('/chunk')), false)
})

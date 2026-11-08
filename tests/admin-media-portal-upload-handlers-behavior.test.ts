import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The Media Portal routes that hand the work to a service after resolving the media
 * configuration — `POST /api/admin/media-portal/upload/init`, `PUT …/upload/:id/chunk`,
 * `POST …/upload/:id/complete`, `POST …/upload/housekeep` and `POST /api/admin/media-portal/:id/process`
 * — run behind a real h3 router. No test ran these handlers; this one pins, before their database
 * access moved into a service:
 *
 *   - the permission each route takes, and every refusal decided before the configuration is read
 *     (no statement runs for those);
 *   - the configuration the service receives is the one resolved from the database (`settings`,
 *     group `media_portal`, read for real on SQLite) — read AFTER the chunk admission and the body;
 *   - the service's refusal reaches the caller with the service's own status and message;
 *   - only a file replacement bumps the chatbot answer cache, after the service returned;
 *   - housekeeping: no pool → 503 before anything is read; the named lock `cdkt:media:housekeep`
 *     taken with timeout 0 on one leased connection, busy → 409 without running the sweep, the lock
 *     released after it;
 *   - processing: the queue row is reset (with its audit row) by the real `enqueueMediaProcessing`,
 *     then the configuration is read, then `processMediaItem` is started without being awaited — its
 *     failure is a `media.transcode_failed` warning, never the response.
 *
 * The chunked-upload barrel, `processMediaItem` (FFmpeg), the answer-cache bump and the logger are
 * the fakes; Drizzle's SQL runs on SQLite (`_sqlite-mysql-db.ts`).
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { settings, mediaItems, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([settings, mediaItems, activityLogs])
const trail = harness.statements

type LockQuery = { sql: string, params: unknown[] }
const lock = { busy: false, queries: [] as LockQuery[], leased: 0, released: 0 }
const fakePool = {
  getConnection: async () => {
    lock.leased += 1
    return {
      query: async (sql: string, params: unknown[] = []) => {
        lock.queries.push({ sql, params })
        trail.push(`@pool ${sql} ${JSON.stringify(params)}`)
        return sql.includes('GET_LOCK') ? [[{ acquired: lock.busy ? 0 : 1 }]] : [[]]
      },
      release: () => { lock.released += 1 },
    }
  },
}
const pool = { current: fakePool as unknown }
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => pool.current } })

type Scripted = Record<string, unknown>
const replies: Record<string, Scripted> = {}
const record = (name: string) => async (input: Record<string, unknown>, deps?: { config?: { maxUploadSize?: number } }) => {
  const { body, ...rest } = input
  const shown = body === undefined ? rest : { ...rest, body: Buffer.isBuffer(body) ? `<${body.length} bytes>` : body }
  trail.push(`@${name} ${JSON.stringify(shown)}${deps?.config ? ` maxUploadSize=${deps.config.maxUploadSize}` : ''}`)
  return replies[name]
}
mock.module('../server/services/chunked-upload', {
  namedExports: {
    initUpload: record('initUpload'),
    chunkBodyLimit: record('chunkBodyLimit'),
    receiveChunk: record('receiveChunk'),
    completeUpload: record('completeUpload'),
    housekeepUploads: async (input: { adminUserId: number, config: { maxUploadSize: number } }) => {
      trail.push(`@housekeepUploads adminUserId=${input.adminUserId} maxUploadSize=${input.config.maxUploadSize}`)
      return replies.housekeepUploads
    },
  },
})

const { RENDITIONS } = await import('../server/services/video-renditions.ts')
const transcode = { fail: null as Error | null }
mock.module('../server/services/video-processing', {
  namedExports: {
    RENDITIONS,
    processMediaItem: async (input: unknown, deps: { config: { maxUploadSize: number } }) => {
      trail.push(`@processMediaItem ${JSON.stringify(input)} maxUploadSize=${deps.config.maxUploadSize}`)
      if (transcode.fail) throw transcode.fail
    },
  },
})
mock.module('../server/services/chatbot-answer-cache', { namedExports: { bumpAnswerCacheVersion: async () => { trail.push('@bump'); return 1 } } })
const warnings: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {}, logInfo: () => {}, logError: () => {},
    logWarn: (entry: Record<string, unknown>) => { warnings.push(entry); trail.push(`@logWarn ${String(entry.event)}`) },
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
const load = async (file: string) => (await import(file)).default as import('h3').EventHandler

let actor: unknown = null
const server = await startHandlerServer([
  { method: 'post', path: '/upload/init', handler: await load('../server/api/admin/media-portal/upload/init.post') },
  { method: 'put', path: '/upload/:id/chunk', handler: await load('../server/api/admin/media-portal/upload/[id]/chunk.put') },
  { method: 'post', path: '/upload/:id/complete', handler: await load('../server/api/admin/media-portal/upload/[id]/complete.post') },
  { method: 'post', path: '/upload/housekeep', handler: await load('../server/api/admin/media-portal/upload/housekeep.post') },
  { method: 'post', path: '/items/:id/process', handler: await load('../server/api/admin/media-portal/[id]/process.post') },
], [h3.defineEventHandler((event) => { event.context.adminUser = actor })])
after(() => server.close())

const grant = (flags: Record<string, boolean>) => ({ resource: 'media_portal', canCreate: false, canRead: false, canUpdate: false, canDelete: false, ...flags })
const UPLOADER = { id: 5, isSuperAdmin: false, permissions: [grant({ canRead: true, canCreate: true })] }
const EDITOR = { id: 6, isSuperAdmin: false, permissions: [grant({ canRead: true, canUpdate: true })] }

const SETTINGS_READ = 'select `key`, `value` from `settings` where `settings`.`group` = ?'
/** What resolving the media configuration reads, in order: the scalar overrides, then the video R2 keys. */
const CONFIG_READS = [SETTINGS_READ, SETTINGS_READ]
const settle = () => new Promise(resolve => setImmediate(resolve))

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(settings).values({ key: 'media_upload_max_size', value: '2097152', group: 'media_portal' })
  await harness.db.insert(mediaItems).values([
    { id: 21, slug: 'cho', shortId: 'cho00001', title: 'Chờ', source: 'upload', processingStatus: 'pending' },
    { id: 22, slug: 'hong', shortId: 'hong0001', title: 'Hỏng', source: 'upload', processingStatus: 'failed', processingAttempts: 3, processingError: 'ffmpeg exited 1', claimedBy: 'w1' },
    { id: 23, slug: 'dang', shortId: 'dang0001', title: 'Đang', source: 'upload', processingStatus: 'processing' },
    { id: 24, slug: 'yt', shortId: 'yt000001', title: 'YouTube', source: 'youtube', processingStatus: 'ready' },
  ])
  trail.length = 0
  warnings.length = 0
  lock.busy = false
  lock.queries.length = 0
  lock.leased = 0
  lock.released = 0
  pool.current = fakePool
  transcode.fail = null
  for (const key of Object.keys(replies)) delete replies[key]
  actor = UPLOADER
})

test('upload/init: create permission, a body that is not an object is a 400 before anything is read, the resolved config reaches initUpload', async () => {
  replies.initUpload = { ok: true, uploadId: 'u-1', chunkSize: 1048576, totalChunks: 2, declaredSize: 2000000, ignored: 'x' }
  const created = await server.request('POST', '/upload/init', { body: { filename: 'a.mp4', declaredSize: 2000000, extra: 1 } })
  assert.equal(created.status, 201)
  assert.deepEqual(created.body, { ok: true, uploadId: 'u-1', chunkSize: 1048576, totalChunks: 2, declaredSize: 2000000 })
  assert.deepEqual(trail, [...CONFIG_READS, '@initUpload {"adminUserId":5,"filename":"a.mp4","declaredSize":2000000} maxUploadSize=2097152'])

  trail.length = 0
  replies.initUpload = { ok: false, status: 413, message: 'Tệp vượt dung lượng cho phép.' }
  const refused = await server.request('POST', '/upload/init', { body: { filename: 'big.mp4', declaredSize: 9e12 } })
  assert.equal(refused.status, 413)
  assert.equal(refused.body.statusMessage, 'Tệp vượt dung lượng cho phép.')

  trail.length = 0
  for (const body of ['"chuoi"', '[1,2]']) {
    const bad = await server.request('POST', '/upload/init', { body, headers: { 'content-type': 'application/json' } })
    assert.equal(bad.status, 400, body)
    assert.equal(bad.body.statusMessage, 'Dữ liệu không hợp lệ.')
  }
  assert.equal((await server.request('POST', '/upload/init')).status, 400)
  assert.deepEqual(trail, [])

  actor = EDITOR
  assert.equal((await server.request('POST', '/upload/init', { body: { filename: 'a.mp4', declaredSize: 1 } })).status, 403)
  assert.deepEqual(trail, [])
})

test('upload/:id/chunk: index checked first, admission before the body, the config read after the body', async () => {
  replies.chunkBodyLimit = { ok: true, bytes: 8 }
  replies.receiveChunk = { ok: true, receivedParts: 1, totalChunks: 2, duplicate: false, extra: 'x' }
  const put = (path: string, bytes: Buffer) => fetch(`${server.origin}${path}`, { method: 'PUT', body: new Uint8Array(bytes), headers: { 'content-type': 'application/octet-stream' } })

  const ok = await put('/upload/u-1/chunk?index=0', Buffer.from('abcdef'))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, receivedParts: 1, totalChunks: 2, duplicate: false })
  assert.deepEqual(trail, [
    '@chunkBodyLimit {"adminUserId":5,"uploadId":"u-1","index":0}',
    ...CONFIG_READS,
    '@receiveChunk {"adminUserId":5,"uploadId":"u-1","index":0,"body":"<6 bytes>"} maxUploadSize=2097152',
  ])

  trail.length = 0
  const tooBig = await put('/upload/u-1/chunk?index=1', Buffer.alloc(9))
  assert.equal(tooBig.status, 413)
  assert.deepEqual(trail, ['@chunkBodyLimit {"adminUserId":5,"uploadId":"u-1","index":1}'], 'nothing read past the bounded body')

  trail.length = 0
  for (const index of ['-1', 'abc', '1.5']) assert.equal((await put(`/upload/u-1/chunk?index=${index}`, Buffer.from('a'))).status, 400, index)
  assert.deepEqual(trail, [])

  replies.chunkBodyLimit = { ok: false, status: 404, message: 'Không tìm thấy lượt tải lên.' }
  const unknown = await put('/upload/u-9/chunk?index=0', Buffer.from('a'))
  assert.equal(unknown.status, 404)
  assert.deepEqual(trail, ['@chunkBodyLimit {"adminUserId":5,"uploadId":"u-9","index":0}'])

  trail.length = 0
  replies.chunkBodyLimit = { ok: true, bytes: 8 }
  replies.receiveChunk = { ok: false, status: 409, message: 'Phần này đang được ghi.' }
  assert.equal((await put('/upload/u-1/chunk?index=0', Buffer.from('a'))).status, 409)

  actor = EDITOR
  trail.length = 0
  assert.equal((await put('/upload/u-1/chunk?index=0', Buffer.from('a'))).status, 403)
  assert.deepEqual(trail, [])
})

test('upload/:id/complete: create for a new item, update for a replacement — only the replacement bumps, after the service', async () => {
  replies.completeUpload = { ok: true, mediaItemId: 31, slug: 'moi', shortId: 'moi00001', contentType: 'video/mp4', extra: 'x' }
  const created = await server.request('POST', '/upload/u-1/complete', { body: {} })
  assert.equal(created.status, 201)
  assert.deepEqual(created.body, { ok: true, mediaItemId: 31, slug: 'moi', shortId: 'moi00001', contentType: 'video/mp4' })
  assert.deepEqual(trail, [...CONFIG_READS, '@completeUpload {"adminUserId":5,"uploadId":"u-1"} maxUploadSize=2097152'])

  trail.length = 0
  assert.equal((await server.request('POST', '/upload/u-1/complete', { body: { replaceMediaItemId: 21 } })).status, 403, 'a replacement needs update')
  assert.deepEqual(trail, [])

  actor = EDITOR
  const replaced = await server.request('POST', '/upload/u-1/complete', { body: { replaceMediaItemId: 21.7 } })
  assert.equal(replaced.status, 201)
  assert.deepEqual(trail, [...CONFIG_READS, '@completeUpload {"adminUserId":6,"uploadId":"u-1","replaceMediaItemId":21} maxUploadSize=2097152', '@bump'])

  trail.length = 0
  assert.equal((await server.request('POST', '/upload/u-1/complete', { body: { replaceMediaItemId: '21' } })).status, 403, 'a string id is no replacement')

  trail.length = 0
  replies.completeUpload = { ok: false, status: 422, message: 'Tệp không phải video.' }
  actor = EDITOR
  const refused = await server.request('POST', '/upload/u-1/complete', { body: { replaceMediaItemId: 21 } })
  assert.equal(refused.status, 422)
  assert.equal(refused.body.statusMessage, 'Tệp không phải video.')
  assert.ok(!trail.includes('@bump'), 'a refused replacement bumped the cache')
})

test('upload/housekeep: confirm first, no pool is a 503 before anything is read, the sweep runs under the named lock', async () => {
  actor = EDITOR
  replies.housekeepUploads = { sessions: 2, orphans: 1, extra: 'x' }
  const swept = await server.request('POST', '/upload/housekeep', { body: { confirm: true } })
  assert.equal(swept.status, 200)
  assert.deepEqual(swept.body, { ok: true, sessions: 2, orphans: 1 })
  assert.deepEqual(trail, [
    ...CONFIG_READS,
    '@pool SELECT GET_LOCK(?, ?) AS acquired ["cdkt:media:housekeep",0]',
    '@housekeepUploads adminUserId=6 maxUploadSize=2097152',
    '@pool SELECT RELEASE_LOCK(?) ["cdkt:media:housekeep"]',
  ])
  assert.deepEqual([lock.leased, lock.released], [1, 1])

  trail.length = 0
  lock.busy = true
  const busy = await server.request('POST', '/upload/housekeep', { body: { confirm: true } })
  assert.equal(busy.status, 409)
  assert.equal(busy.body.statusMessage, 'Một lượt dọn khác đang chạy. Thử lại sau.')
  assert.deepEqual(trail, [...CONFIG_READS, '@pool SELECT GET_LOCK(?, ?) AS acquired ["cdkt:media:housekeep",0]'], 'the sweep ran without the lock, or the lock was released though never held')

  trail.length = 0
  pool.current = null
  const noPool = await server.request('POST', '/upload/housekeep', { body: { confirm: true } })
  assert.equal(noPool.status, 503)
  assert.equal(noPool.body.statusMessage, 'Cơ sở dữ liệu chưa sẵn sàng.')
  assert.deepEqual(trail, [])

  pool.current = fakePool
  for (const body of [{}, { confirm: 'true' }, { confirm: 1 }]) {
    const unconfirmed = await server.request('POST', '/upload/housekeep', { body })
    assert.equal(unconfirmed.status, 400, JSON.stringify(body))
  }
  assert.deepEqual(trail, [])

  actor = UPLOADER
  assert.equal((await server.request('POST', '/upload/housekeep', { body: { confirm: true } })).status, 403)
  assert.deepEqual(trail, [])
})

test('items/:id/process: renditions checked first, the queue row reset with its audit, then the config, then the transcode is started and not awaited', async () => {
  actor = EDITOR
  const ENQUEUE = 'select `id`, `slug`'
  const started = await server.request('POST', '/items/22/process', { body: { renditions: [' 720p', '360p', '720p'] } })
  await settle()
  assert.equal(started.status, 202)
  assert.deepEqual(started.body, { ok: true, message: 'Đã đưa mục vào hàng chờ chuyển mã.' })
  const enqueue = trail.slice(0, trail.length - CONFIG_READS.length - 1)
  assert.ok(enqueue[0]!.startsWith(ENQUEUE) && enqueue[0]!.includes('from `media_items`'), enqueue[0])
  assert.deepEqual(enqueue.slice(1), [
    'update `media_items` set `processing_status` = ?, `processing_error` = ?, `claimed_by` = ?, `processing_attempts` = ?, `processing_next_attempt_at` = ?, `processing_heartbeat_at` = ? where `media_items`.`id` = ?',
    'insert into `activity_logs` (`id`, `user_id`, `action`, `resource`, `resource_id`, `meta`, `created_at`) values (default, ?, ?, ?, ?, ?, default)',
  ])
  assert.deepEqual(trail.slice(enqueue.length), [...CONFIG_READS, '@processMediaItem {"mediaItemId":22,"renditions":["720p","360p"]} maxUploadSize=2097152'])
  const reset = harness.rows(mediaItems).find(row => row.id === 22)!
  assert.deepEqual([reset.processingStatus, reset.processingAttempts, reset.processingError, reset.claimedBy], ['pending', 0, null, null])
  assert.deepEqual(harness.rows(activityLogs).map(row => [row.userId, row.action, row.resource, row.resourceId, row.meta]), [[6, 'update', 'media_portal', 22, { operation: 'retry_processing' }]])

  trail.length = 0
  transcode.fail = new Error('ffmpeg missing')
  const failing = await server.request('POST', '/items/21.9/process')
  await settle()
  assert.equal(failing.status, 202, 'a failing transcode is never the response')
  assert.deepEqual(trail.slice(-2), ['@processMediaItem {"mediaItemId":21} maxUploadSize=2097152', '@logWarn media.transcode_failed'])
  assert.deepEqual(warnings, [{ event: 'media.transcode_failed', mediaItemId: 21, message: 'ffmpeg missing' }])

  transcode.fail = null
  for (const [path, status, message] of [
    ['/items/99/process', 404, 'Không tìm thấy mục media này.'],
    ['/items/24/process', 400, 'Chỉ mục tự lưu trữ mới cần chuyển mã.'],
    ['/items/23/process', 409, 'Video đang được xử lý. Vui lòng đợi hoàn tất.'],
  ] as const) {
    trail.length = 0
    const refused = await server.request('POST', path, { body: {} })
    assert.equal(refused.status, status, path)
    assert.equal(refused.body.statusMessage, message)
    assert.ok(!trail.some(entry => entry.startsWith('@') || entry === SETTINGS_READ), `${path}: the config was read or the transcode started after a refusal`)
  }

  trail.length = 0
  for (const [body, message] of [
    [{ renditions: [] }, 'Cần chọn ít nhất một bản chuyển mã.'],
    [{ renditions: [' ', 7] }, 'Cần chọn ít nhất một bản chuyển mã.'],
    [{ renditions: ['360p', '4K', '8K'] }, 'Bản chuyển mã không hợp lệ: 4K, 8K.'],
  ] as const) {
    const refused = await server.request('POST', '/items/21/process', { body })
    assert.equal(refused.status, 400, JSON.stringify(body))
    assert.equal(refused.body.statusMessage, message)
  }
  for (const id of ['0', 'abc', '-3']) assert.equal((await server.request('POST', `/items/${id}/process`, { body: {} })).status, 400, id)
  assert.deepEqual(trail, [])

  actor = UPLOADER
  assert.equal((await server.request('POST', '/items/21/process', { body: {} })).status, 403)
  assert.deepEqual(trail, [])
})

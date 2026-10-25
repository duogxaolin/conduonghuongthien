import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import sharp from 'sharp'

/**
 * Hành vi các đường GHI quản trị của cổng media chưa có test hành vi nào:
 *
 *  - `deleteMediaItem`: hàng outbox `media_asset_cleanup` (khi có gốc tài sản hợp
 *    lệ), lượt xoá hàng và dòng audit — cả ba trên handle giao dịch, đúng thứ tự.
 *  - `updateMediaItem`: lượt xuất bản ĐẦU TIÊN đóng dấu `published_at` và ghi
 *    audit `publish`; đăng lại giữ dấu cũ; không đổi gì vẫn ghi audit.
 *  - `createMediaItem`: mục nguồn ngoài sẵn sàng ngay, bỏ `storagePath`.
 *  - `setMediaThumbnail` khi video nằm trên R2: đẩy `thumb.jpg` lên bucket VIDEO;
 *    bước CSDL hỏng thì trả tệp đĩa + R2 về như cũ.
 *  - `clearMediaThumbnail`: chưa có test nào.
 *
 * (`tests/media-api.test.ts` đã khoá tính nguyên tử hàng + audit của create/update/
 * delete trên Drizzle thật; `tests/media-portal-thumbnail-source.test.ts` khoá
 * nguồn ảnh thư viện của `setMediaThumbnail`.) Chạy hàm THẬT qua barrel
 * `server/services/media-portal.ts`, SDK S3 giả là biên mạng duy nhất.
 */

// ─── Fake S3 SDK (the only network edge) ──────────────────────────────────────
type Sent = { name: string, input: Record<string, unknown> }
const s3 = {
  constructed: [] as Array<{ endpoint: string }>,
  sent: [] as Sent[],
  fails: new Set<string>(),
}
class FakeS3Client {
  constructor(config: { endpoint: string }) { s3.constructed.push(config) }
  async send(command: { input: Record<string, unknown>, constructor: { name: string } }) {
    const sent = { name: command.constructor.name, input: command.input }
    s3.sent.push(sent)
    if (s3.fails.has(sent.name)) throw new Error('r2 down')
    return {}
  }
}
class Command {
  input: Record<string, unknown>
  constructor(input: Record<string, unknown>) { this.input = input }
}
class GetObjectCommand extends Command {}
class PutObjectCommand extends Command {}
class DeleteObjectCommand extends Command {}
class DeleteObjectsCommand extends Command {}
class HeadObjectCommand extends Command {}
class ListObjectsV2Command extends Command {}
mock.module('@aws-sdk/client-s3', {
  namedExports: {
    S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command,
  },
})

const logs: Array<Record<string, unknown>> = []
mock.method(console, 'error', (line: unknown) => {
  try { logs.push(JSON.parse(String(line))) } catch { /* not a log record */ }
})

const portal = await import('../server/services/media-portal.ts')
const schema = await import('../server/db/schema.ts')
const { createMediaItem, updateMediaItem, deleteMediaItem, setMediaThumbnail, clearMediaThumbnail, MediaValidationError } = portal

// ─── Fake DB: reads by table, writes recorded per handle ─────────────────────
type Write = { op: 'insert' | 'update' | 'delete', table: unknown, values?: Record<string, unknown> }
const state = {
  rows: new Map<unknown, Array<Record<string, unknown>>>(),
  txWrites: [] as Write[],
  poolWrites: [] as Write[],
  transactions: 0,
  txFails: false,
}
const reader = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = () => state.rows.get(table) ?? []
        // `uniqueMediaSlug` awaits `where()` itself; the others call `.limit(1)`.
        return Object.assign(Promise.resolve(rows()), { limit: async () => rows().slice(0, 1) })
      },
    }),
  }),
}
const writer = (into: Write[]) => ({
  insert: (table: unknown) => ({
    values: async (values: Record<string, unknown>) => { into.push({ op: 'insert', table, values }); return [{ insertId: 77 }] },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({ where: async () => { into.push({ op: 'update', table, values }) } }),
  }),
  delete: (table: unknown) => ({ where: async () => { into.push({ op: 'delete', table }) } }),
})
const fakeDb = {
  ...reader,
  ...writer(state.poolWrites),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    state.transactions++
    if (state.txFails) throw new Error('db down')
    return fn({ ...reader, ...writer(state.txWrites) })
  },
}
const deps = { db: fakeDb as never }
const ops = () => state.txWrites.map(write => [write.op, write.table])
const audit = () => state.txWrites.find(write => write.table === schema.activityLogs)?.values

const HEX = '0123456789abcdef0123456789abcdef'
const videoR2 = { accountId: HEX, accessKeyId: 'AKIA', secretAccessKey: 'secret', bucket: 'video-bucket', publicUrl: 'https://cdn.example.com' }
const originalCwd = process.cwd()
let workdir = ''
let png: Buffer
let libraryImage = ''
const localConfig = () => ({ workdir, videoStorage: { provider: 'local' } }) as never
const r2Config = (r2: Record<string, string> = videoR2) => ({ workdir, videoStorage: { provider: 'r2', r2 } }) as never
const thumbFile = () => path.join(workdir, 'media', 'clip', 'thumb.jpg')
const put = (relative: string, content: string | Buffer) => {
  const file = path.join(workdir, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
  return file
}

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-media-write-'))
  process.chdir(workdir)
  png = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#4A6741' } }).png().toBuffer()
  libraryImage = put('public/uploads/2026/10/cover.png', png)
})
after(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})
beforeEach(() => {
  rmSync(path.join(workdir, 'media'), { recursive: true, force: true })
  state.rows = new Map()
  state.txWrites.length = 0
  state.poolWrites.length = 0
  state.transactions = 0
  state.txFails = false
  s3.constructed = []
  s3.sent = []
  s3.fails = new Set()
  logs.length = 0
})

// ─── deleteMediaItem ──────────────────────────────────────────────────────────

describe('deleteMediaItem', () => {
  const current = (over: Record<string, unknown> = {}) => ({
    id: 5, slug: 'clip', source: 'upload', status: 'published',
    storagePath: 'media/clip/generations/g1', storageProvider: 'r2', claimedBy: 'claim-1', ...over,
  })

  it('an upload: cleanup outbox row, row delete, audit row — all on the tx handle, in that order', async () => {
    state.rows.set(schema.mediaItems, [current()])
    const startedAt = Date.now()
    assert.deepEqual(await deleteMediaItem({ id: 5, actorId: 7 }, deps), { removed: true, fromStatus: 'published' })

    assert.equal(state.transactions, 1)
    assert.deepEqual(state.poolWrites, [])
    assert.deepEqual(ops(), [['insert', schema.mediaAssetCleanup], ['delete', schema.mediaItems], ['insert', schema.activityLogs]])
    const outbox = state.txWrites[0]!.values!
    assert.equal(outbox.assetRoot, 'media/clip', 'the outbox names the base asset root, not the generation')
    assert.equal(outbox.storageProvider, 'r2', 'the worker deletes on the backend the row was on')
    assert.match(String(outbox.id), /^[0-9a-f-]{36}$/)
    const due = (outbox.nextAttemptAt as Date).getTime()
    assert.ok(due >= startedAt + 30_000 && due <= Date.now() + 30_000, 'the first attempt is deferred ~30 s')
    assert.deepEqual(audit(), {
      userId: 7, action: 'delete', resource: 'media_portal', resourceId: 5,
      meta: { source: 'upload', fromStatus: 'published' },
    })
  })

  it('no outbox row for an external item, or an upload whose legacy path is not a media asset root', async () => {
    state.rows.set(schema.mediaItems, [current({ source: 'youtube', storagePath: null, status: 'draft' })])
    assert.deepEqual(await deleteMediaItem({ id: 5, actorId: 7 }, deps), { removed: true, fromStatus: 'draft' })
    assert.deepEqual(ops(), [['delete', schema.mediaItems], ['insert', schema.activityLogs]])

    state.txWrites.length = 0
    state.rows.set(schema.mediaItems, [current({ storagePath: 'uploads/legacy/../x' })])
    assert.deepEqual(await deleteMediaItem({ id: 5, actorId: 7 }, deps), { removed: true, fromStatus: 'published' })
    assert.deepEqual(ops(), [['delete', schema.mediaItems], ['insert', schema.activityLogs]])
  })

  it('a missing item writes nothing', async () => {
    assert.deepEqual(await deleteMediaItem({ id: 404, actorId: 7 }, deps), { removed: false, fromStatus: null })
    assert.deepEqual(state.txWrites, [])
    assert.deepEqual(state.poolWrites, [])
  })
})

// ─── updateMediaItem ──────────────────────────────────────────────────────────

describe('updateMediaItem', () => {
  const current = (over: Record<string, unknown> = {}) =>
    state.rows.set(schema.mediaItems, [{ id: 5, slug: 'clip', status: 'draft', publishedAt: null, ...over }])
  const update = () => state.txWrites.find(write => write.op === 'update')?.values

  it('the first publish stamps published_at and is audited as `publish`', async () => {
    current()
    assert.deepEqual(await updateMediaItem({ id: 5, actorId: 7, status: ' Published ' }, deps), { ok: true, slug: 'clip', status: 'published' })
    assert.equal(update()!.status, 'published')
    assert.ok(update()!.publishedAt instanceof Date)
    assert.deepEqual(audit(), {
      userId: 7, action: 'publish', resource: 'media_portal', resourceId: 5,
      meta: { changed: ['status'], fromStatus: 'draft', toStatus: 'published' },
    })
    assert.deepEqual(state.poolWrites, [])
  })

  it('re-publishing keeps the first stamp; leaving or re-sending `published` is an `update`', async () => {
    current({ status: 'archived', publishedAt: new Date('2026-01-01T00:00:00Z') })
    await updateMediaItem({ id: 5, actorId: 7, status: 'published' }, deps)
    assert.ok(!('publishedAt' in update()!))
    assert.equal(audit()!.action, 'publish')

    for (const [from, to] of [['published', 'archived'], ['published', 'published']]) {
      state.txWrites.length = 0
      current({ status: from, publishedAt: new Date('2026-01-01T00:00:00Z') })
      await updateMediaItem({ id: 5, actorId: 7, status: to }, deps)
      assert.ok(!('publishedAt' in update()!))
      assert.deepEqual(audit()!.meta, { changed: ['status'], fromStatus: from, toStatus: to })
      assert.equal(audit()!.action, 'update')
    }
  })

  it('maps each supplied field and lists exactly those fields in the audit row', async () => {
    current()
    await updateMediaItem({ id: 5, actorId: 7, title: '  Tên mới ', description: '', isFeatured: 1, commentsEnabled: '0' }, deps)
    assert.deepEqual(update(), { title: 'Tên mới', description: null, commentsEnabled: false, isFeatured: true })
    assert.deepEqual(audit()!.meta, { changed: ['title', 'description', 'commentsEnabled', 'isFeatured'], fromStatus: 'draft', toStatus: 'draft' })
  })

  it('no field supplied → no row update, but the audit row is still written', async () => {
    current()
    assert.deepEqual(await updateMediaItem({ id: 5, actorId: 7 }, deps), { ok: true, slug: 'clip', status: 'draft' })
    assert.deepEqual(ops(), [['insert', schema.activityLogs]])
    assert.deepEqual(audit()!.meta, { changed: [], fromStatus: 'draft', toStatus: 'draft' })
  })

  it('invalid input is refused before any transaction opens', async () => {
    current()
    for (const input of [{ title: '' }, { status: 'deleted' }, { isFeatured: 'false' }, { youtubeVideoId: 'not a video' }, { categoryId: -1 }]) {
      await assert.rejects(updateMediaItem({ id: 5, actorId: 7, ...input }, deps), MediaValidationError, JSON.stringify(input))
    }
    assert.equal(state.transactions, 0)
  })
})

// ─── createMediaItem ──────────────────────────────────────────────────────────

describe('createMediaItem', () => {
  const inserted = () => state.txWrites.find(write => write.table === schema.mediaItems)?.values

  it('an external item is ready at once, keeps the extracted video id and drops any storage path', async () => {
    const created = await createMediaItem({
      title: 'Phim tài liệu', source: 'youtube', youtubeVideoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      storagePath: 'media/x', categoryId: '3', createdBy: 7,
    }, deps)
    assert.equal(created.mediaItemId, 77)
    assert.equal(created.slug, 'phim-tai-lieu')
    assert.equal(typeof created.shortId, 'string')
    const row = inserted()!
    assert.equal(row.source, 'youtube')
    assert.equal(row.youtubeVideoId, 'dQw4w9WgXcQ')
    assert.equal(row.storagePath, null)
    assert.equal(row.processingStatus, 'ready')
    assert.equal(row.status, 'draft')
    assert.equal(row.categoryId, 3)
    assert.deepEqual(audit(), { userId: 7, action: 'create', resource: 'media_portal', resourceId: 77, meta: { source: 'youtube', hasCategory: true } })
  })

  it('an upload waits for processing and keeps its storage path; no video id', async () => {
    await createMediaItem({ title: 'Clip', storagePath: ' media/clip ', youtubeVideoId: 'dQw4w9WgXcQ', createdBy: 7 }, deps)
    const row = inserted()!
    assert.equal(row.source, 'upload')
    assert.equal(row.processingStatus, 'pending')
    assert.equal(row.storagePath, 'media/clip')
    assert.equal(row.youtubeVideoId, null)
    assert.deepEqual(audit()!.meta, { source: 'upload', hasCategory: false })
  })

  it('an external item without a usable video id is refused before any transaction', async () => {
    await assert.rejects(createMediaItem({ title: 'X', source: 'youtube', youtubeVideoId: 'nope', createdBy: 7 }, deps), MediaValidationError)
    assert.equal(state.transactions, 0)
  })
})

// ─── setMediaThumbnail: video on R2 ───────────────────────────────────────────

describe('setMediaThumbnail — refusals and a video stored on R2', () => {
  const item = (over: Record<string, unknown> = {}) => state.rows.set(schema.mediaItems, [{
    id: 1, source: 'upload', storagePath: 'media/clip', storageProvider: 'r2', slug: 'clip', ...over,
  }])
  const image = (over: Record<string, unknown> = {}) => state.rows.set(schema.media, [{
    id: 9, provider: 'local', storagePath: libraryImage, mimeType: 'image/png', url: '/uploads/2026/10/cover.png', ...over,
  }])
  const run = (config = r2Config()) => setMediaThumbnail({ id: 1, mediaId: 9, actorId: 3, config }, deps)
  const puts = () => s3.sent.filter(c => c.name === 'PutObjectCommand')

  it('refuses a missing item, an external item, a missing image and a non-image — nothing written', async () => {
    image()
    assert.deepEqual(await run(), { ok: false, reason: 'not_found' })
    item({ source: 'youtube' })
    assert.deepEqual(await run(), { ok: false, reason: 'not_upload' })
    item()
    state.rows.delete(schema.media)
    assert.deepEqual(await run(), { ok: false, reason: 'media_not_found' })
    image({ mimeType: 'application/pdf' })
    assert.deepEqual(await run(), { ok: false, reason: 'not_an_image' })
    assert.equal(state.transactions, 0)
    assert.ok(!existsSync(thumbFile()))
    assert.deepEqual(s3.sent, [])
  })

  it('writes thumb.jpg on disk and at <storagePath>/thumb.jpg on the VIDEO bucket, then update + audit in one tx', async () => {
    item()
    image()
    assert.deepEqual(await run(), { ok: true })
    const onDisk = readFileSync(thumbFile())
    assert.deepEqual(puts().map(c => [c.input.Bucket, c.input.Key, c.input.ContentType]), [['video-bucket', 'media/clip/thumb.jpg', 'image/jpeg']])
    assert.deepEqual(puts()[0]!.input.Body, onDisk)
    assert.deepEqual(state.txWrites[0], { op: 'update', table: schema.mediaItems, values: { thumbnailUrl: '/uploads/2026/10/cover.png' } })
    assert.deepEqual(audit(), {
      userId: 3, action: 'update', resource: 'media_portal', resourceId: 1,
      meta: { changed: ['thumbnail'], thumbSource: 'media_library', mediaId: 9, pushedR2: true },
    })
  })

  it('an R2 push failure keeps the disk thumbnail and records pushedR2: false; a local video never touches R2', async () => {
    item()
    image()
    s3.fails.add('PutObjectCommand')
    assert.deepEqual(await run(), { ok: true })
    assert.ok(existsSync(thumbFile()))
    assert.equal((audit()!.meta as Record<string, unknown>).pushedR2, false)

    state.txWrites.length = 0
    s3.sent = []
    item({ storageProvider: 'local' })
    assert.deepEqual(await run(), { ok: true })
    assert.deepEqual(s3.sent, [])
    assert.equal((audit()!.meta as Record<string, unknown>).pushedR2, false)
  })

  it('the DB step fails → disk and R2 are put back: old bytes re-uploaded, or the new object deleted', async () => {
    item()
    image()
    const previous = Buffer.from('anh-cu')
    put('media/clip/thumb.jpg', previous)
    state.txFails = true
    await assert.rejects(run(), /db down/)
    assert.deepEqual(readFileSync(thumbFile()), previous)
    assert.deepEqual(puts().at(-1)!.input.Body, previous)
    const restoreLog = logs.find(log => log.event === 'media_portal.thumbnail_db_write_failed')
    assert.equal(restoreLog?.mediaItemId, 1)
    assert.equal(restoreLog?.filesRestored, true)

    rmSync(thumbFile())
    s3.sent = []
    await assert.rejects(run(), /db down/)
    assert.ok(!existsSync(thumbFile()))
    assert.deepEqual(s3.sent.map(c => [c.name, c.input.Key]), [['PutObjectCommand', 'media/clip/thumb.jpg'], ['DeleteObjectCommand', 'media/clip/thumb.jpg']])
  })
})

// ─── clearMediaThumbnail ──────────────────────────────────────────────────────

describe('clearMediaThumbnail', () => {
  const item = (over: Record<string, unknown> = {}) => state.rows.set(schema.mediaItems, [{
    id: 1, source: 'upload', storagePath: 'media/clip', storageProvider: 'local', slug: 'clip', ...over,
  }])
  const run = (config = localConfig()) => clearMediaThumbnail({ id: 1, actorId: 3, config }, deps)
  const reset = () => {
    assert.deepEqual(state.txWrites[0], { op: 'update', table: schema.mediaItems, values: { thumbnailUrl: null } })
    assert.deepEqual(audit(), { userId: 3, action: 'update', resource: 'media_portal', resourceId: 1, meta: { changed: ['thumbnail'], cleared: true } })
    assert.deepEqual(state.poolWrites, [])
  }

  it('refuses a missing or external item — nothing removed, nothing written', async () => {
    const root = put('media/clip/thumb.jpg', 'custom')
    assert.deepEqual(await run(), { ok: false, reason: 'not_found' })
    item({ source: 'youtube' })
    assert.deepEqual(await run(), { ok: false, reason: 'not_upload' })
    assert.ok(existsSync(root))
    assert.equal(state.transactions, 0)
  })

  it('local: removes only the ROOT thumb.jpg (the generated one stays), resets thumbnail_url + audit in one tx', async () => {
    item()
    const root = put('media/clip/thumb.jpg', 'custom')
    const generated = put('media/clip/generations/g1/thumb.jpg', 'auto')
    assert.deepEqual(await run(), { ok: true })
    assert.ok(!existsSync(root))
    assert.ok(existsSync(generated))
    assert.deepEqual(s3.sent, [])
    reset()
  })

  it('R2: deletes <storagePath>/thumb.jpg from the video bucket', async () => {
    item({ storageProvider: 'r2' })
    assert.deepEqual(await run(r2Config()), { ok: true })
    assert.deepEqual(s3.sent.map(c => [c.name, c.input]), [['DeleteObjectCommand', { Bucket: 'video-bucket', Key: 'media/clip/thumb.jpg' }]])
    assert.ok(!logs.some(log => log.event === 'media_portal.thumbnail_r2_delete_failed'))
    reset()
  })

  it('R2 delete fails, or the stored R2 config is unusable → the DB is still reset and the leftover is logged', async () => {
    item({ storageProvider: 'r2' })
    s3.fails.add('DeleteObjectCommand')
    assert.deepEqual(await run(r2Config()), { ok: true })
    reset()
    assert.ok(logs.some(log => log.event === 'media_portal.thumbnail_r2_delete_failed' && log.storagePath === 'media/clip'))

    state.txWrites.length = 0
    logs.length = 0
    s3.constructed = []
    assert.deepEqual(await run(r2Config({ ...videoR2, accountId: 'evil.example#' })), { ok: true })
    assert.equal(s3.constructed.length, 0, 'no client is built for an unusable config')
    reset()
    assert.ok(logs.some(log => log.event === 'media_portal.thumbnail_r2_delete_failed'))
  })
})

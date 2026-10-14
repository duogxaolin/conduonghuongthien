import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test, { after, before, beforeEach, mock } from 'node:test'
import sharp from 'sharp'

/**
 * `setMediaThumbnail` đọc ảnh Thư viện Media làm thumbnail video — KHÔNG qua
 * `fetch(img.url)`.
 *
 * Trước đây ảnh thư viện trên R2 được tải bằng `fetch` trần tới `media.url`: không
 * hạn thời gian, không trần byte, không kiểm host, theo chuyển hướng. `media.url`
 * là một ô CSDL (đi theo bản khôi phục / import SQL / sửa tay) — `http://169.254.169.254/…`
 * hay một host nội bộ biến nút "đặt thumbnail" thành SSRF có kênh đọc ngược (bytes
 * thành ảnh thumbnail công khai). Ảnh local thì `fs.readFile(storagePath)` với
 * đường dẫn tuyệt đối lấy thẳng từ CSDL, không giới hạn thư mục.
 *
 * Nay: ảnh R2 đọc bằng KHOÁ (`storagePath`) qua `getR2Object` với cấu hình R2 của
 * thư viện ảnh (endpoint đã kiểm `<hex>.r2.cloudflarestorage.com`, trần byte, hạn
 * thời gian) — `media.url` không bao giờ được gọi; ảnh local phải nằm dưới
 * `<cwd>/public/uploads`, là tệp thường, dưới trần. Test chạy hàm thật với SDK S3
 * giả (biên mạng duy nhất) và `fetch` bị gài bẫy.
 */

// ─── Fake S3 SDK (the only network edge) ──────────────────────────────────────
type Sent = { name: string, input: Record<string, unknown>, options?: { abortSignal?: AbortSignal } }
const s3 = {
  constructed: [] as Array<{ endpoint: string }>,
  sent: [] as Sent[],
  respond: (_cmd: Sent): Promise<unknown> => Promise.resolve({}),
}
class FakeS3Client {
  config: { endpoint: string }
  constructor(config: { endpoint: string }) {
    s3.constructed.push(config)
    this.config = config
  }
  async send(command: { input: Record<string, unknown>, constructor: { name: string } }, options?: { abortSignal?: AbortSignal }) {
    const sent = { name: command.constructor.name, input: command.input, options }
    s3.sent.push(sent)
    return s3.respond(sent)
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

const HEX = '0123456789abcdef0123456789abcdef'
let libraryR2 = { accountId: HEX, accessKeyId: 'AKIA', secretAccessKey: 'secret', bucket: ' media-bucket ', publicUrl: 'https://cdn.example.com' }
mock.module('../server/services/media', { namedExports: { loadR2Config: async () => libraryR2 } })

const fetchCalls: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: unknown) => {
  fetchCalls.push(String(input))
  throw new Error('fetch must not be used for library images')
}) as typeof fetch

const portal = await import('../server/services/media-portal')
const r2 = await import('../server/utils/media-r2')
const { setMediaThumbnail, THUMBNAIL_SOURCE_MAX_BYTES } = portal

// ─── Fake DB ─────────────────────────────────────────────────────────────────
const schema = await import('../server/db/schema')
const state = {
  item: null as Record<string, unknown> | null,
  img: null as Record<string, unknown> | null,
  writes: [] as string[],
}
const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === schema.mediaItems) return state.item ? [state.item] : []
          if (table === schema.media) return state.img ? [state.img] : []
          return []
        },
      }),
    }),
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    update: () => ({ set: () => ({ where: async () => { state.writes.push('update') } }) }),
    insert: () => ({ values: async () => { state.writes.push('audit') } }),
  }),
}

const originalCwd = process.cwd()
let workdir = ''
let png: Buffer
const config = () => ({ workdir, videoStorage: { provider: 'local' } }) as never
const thumbPath = () => path.join(workdir, 'media', 'clip', 'thumb.jpg')

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-thumb-src-'))
  process.chdir(workdir)
  png = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#4A6741' } }).png().toBuffer()
})
after(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
  globalThis.fetch = realFetch
})
beforeEach(() => {
  rmSync(path.join(workdir, 'media'), { recursive: true, force: true })
  s3.constructed = []
  s3.sent = []
  s3.respond = async () => ({ Body: Readable.from([png]), ContentLength: png.length })
  fetchCalls.length = 0
  state.writes = []
  libraryR2 = { accountId: HEX, accessKeyId: 'AKIA', secretAccessKey: 'secret', bucket: ' media-bucket ', publicUrl: 'https://cdn.example.com' }
  state.item = { id: 1, source: 'upload', storagePath: 'media/clip', storageProvider: 'local', slug: 'clip' }
})

const run = () => setMediaThumbnail({ id: 1, mediaId: 9, actorId: 3, config: config() }, { db: fakeDb as never })
const r2Image = (url: string) => ({ id: 9, provider: 'r2', storagePath: '2026/10/cover.png', mimeType: 'image/png', url })

test('an R2 library image is read by KEY through the checked R2 endpoint — its stored URL is never fetched', async () => {
  state.img = r2Image('http://169.254.169.254/latest/meta-data/iam')
  assert.deepEqual(await run(), { ok: true })
  assert.deepEqual(fetchCalls, [], 'media.url was not requested')
  assert.equal(s3.constructed.length, 1)
  assert.equal(new URL(s3.constructed[0]!.endpoint).hostname, `${HEX}.r2.cloudflarestorage.com`)
  const get = s3.sent.find(c => c.name === 'GetObjectCommand')!
  assert.deepEqual(get.input, { Bucket: 'media-bucket', Key: '2026/10/cover.png' })
  assert.ok(get.options?.abortSignal, 'the read has a deadline')
  assert.ok(existsSync(thumbPath()), 'thumbnail written')
  assert.deepEqual(state.writes, ['update', 'audit'])
})

test('a declared R2 object over the cap is refused before reading; nothing written', async () => {
  state.img = r2Image('https://cdn.example.com/2026/10/cover.png')
  let destroyed = false
  s3.respond = async () => {
    const body = Readable.from([png])
    const destroy = body.destroy.bind(body)
    body.destroy = ((e?: Error) => { destroyed = true; return destroy(e) }) as typeof body.destroy
    return { Body: body, ContentLength: THUMBNAIL_SOURCE_MAX_BYTES + 1 }
  }
  await assert.rejects(run(), (err: unknown) => err instanceof r2.R2ReadLimitError && err.reason === 'too_large')
  assert.ok(destroyed)
  assert.ok(!existsSync(thumbPath()))
  assert.deepEqual(state.writes, [])
  assert.deepEqual(fetchCalls, [])
})

test('an undeclared R2 body is counted while streaming and cut at the cap', async () => {
  let produced = 0
  s3.respond = async () => ({
    Body: new Readable({
      read() {
        produced += 64 * 1024
        this.push(Buffer.alloc(64 * 1024))
      },
    }),
  })
  await assert.rejects(r2.getR2Object('k', libraryR2, { maxBytes: 256 * 1024 }), (err: unknown) => err instanceof r2.R2ReadLimitError && err.reason === 'too_large')
  assert.ok(produced <= 512 * 1024, `stopped near the cap, produced ${produced}`)
})

test('an R2 read that stalls hits the deadline', async () => {
  s3.respond = async () => ({ Body: new Readable({ read() { /* never ends */ } }) })
  await assert.rejects(r2.getR2Object('k', libraryR2, { timeoutMs: 50 }), (err: unknown) => err instanceof r2.R2ReadLimitError && err.reason === 'timeout')
})

test('an unusable stored library R2 config is refused with the classified error — no client, no fetch', async () => {
  state.img = r2Image('https://cdn.example.com/2026/10/cover.png')
  libraryR2 = { ...libraryR2, accountId: 'evil.example#' }
  await assert.rejects(run(), (err: unknown) => err instanceof r2.R2ConfigInvalidError)
  assert.equal(s3.constructed.length, 0)
  assert.deepEqual(fetchCalls, [])
  assert.deepEqual(state.writes, [])
})

test('a local library image must live under public/uploads: a stored path elsewhere is refused', async () => {
  const outside = path.join(workdir, 'secret.png')
  writeFileSync(outside, png)
  state.img = { id: 9, provider: 'local', storagePath: outside, mimeType: 'image/png', url: '/uploads/x.png' }
  await assert.rejects(run(), /Ảnh thư viện/)
  assert.ok(!existsSync(thumbPath()))
  assert.deepEqual(state.writes, [])

  for (const sneaky of [path.join(workdir, 'public', 'uploads', '..', 'secret.png'), path.join(workdir, 'public', 'uploads-evil', 'x.png')]) {
    mkdirSync(path.dirname(sneaky), { recursive: true })
    writeFileSync(sneaky, png)
    state.img = { ...state.img, storagePath: sneaky }
    await assert.rejects(run(), /Ảnh thư viện/, sneaky)
  }
})

test('a local library image under public/uploads works; one over the cap is refused', async () => {
  const dir = path.join(workdir, 'public', 'uploads', '2026', '10')
  mkdirSync(dir, { recursive: true })
  const good = path.join(dir, 'cover.png')
  writeFileSync(good, png)
  state.img = { id: 9, provider: 'local', storagePath: good, mimeType: 'image/png', url: '/uploads/2026/10/cover.png' }
  assert.deepEqual(await run(), { ok: true })
  assert.ok(existsSync(thumbPath()))

  rmSync(path.join(workdir, 'media'), { recursive: true, force: true })
  state.writes = []
  const huge = path.join(dir, 'huge.png')
  writeFileSync(huge, png)
  truncateSync(huge, THUMBNAIL_SOURCE_MAX_BYTES + 1) // sparse: no real disk use
  state.img = { ...state.img, storagePath: huge }
  await assert.rejects(run(), /quá lớn/)
  assert.ok(!existsSync(thumbPath()))
  assert.deepEqual(state.writes, [])
})

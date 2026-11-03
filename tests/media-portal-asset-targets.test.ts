import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * Hành vi của đường phân giải tệp công khai (`resolveStreamTarget`,
 * `resolveThumbnailTarget`) và hai hàm đường dẫn nó dựa vào (`normalizeAssetPath`,
 * `resolveMediaDirectory`).
 *
 * `tests/media-api.test.ts` chỉ chạy nhánh đĩa local qua endpoint thật. Các nhánh
 * R2 (manifest chưa xuất bản → tệp gốc trên R2 → tệp gốc trên đĩa; thumbnail gốc
 * vs `generations/<claim>/thumb.jpg`) và phép chọn thumbnail mới nhất trên đĩa thì
 * chưa có test hành vi nào — test này chạy hàm THẬT qua barrel
 * `server/services/media-portal.ts`, với SDK S3 giả là biên mạng duy nhất (cùng lối
 * `tests/media-portal-thumbnail-source.test.ts`), CSDL giả nhận `where` thật (biên
 * dịch bằng `MySqlDialect` để biết tra theo `short_id` hay `slug`), và một cây
 * thư mục tạm thật.
 */

// ─── Fake S3 SDK (the only network edge) ──────────────────────────────────────
type Sent = { name: string, input: Record<string, unknown> }
const s3 = {
  sent: [] as Sent[],
  /** Khoá R2 đang có (ListObjectsV2 trả về, HeadObject thấy). */
  keys: [] as string[],
  listFails: false,
}
class FakeS3Client {
  async send(command: { input: Record<string, unknown>, constructor: { name: string } }) {
    const sent = { name: command.constructor.name, input: command.input }
    s3.sent.push(sent)
    if (sent.name === 'ListObjectsV2Command') {
      if (s3.listFails) throw new Error('r2 down')
      const prefix = String(sent.input.Prefix ?? '')
      return { Contents: s3.keys.filter(key => key.startsWith(prefix)).map(Key => ({ Key })), IsTruncated: false }
    }
    if (sent.name === 'HeadObjectCommand') {
      if (!s3.keys.includes(String(sent.input.Key))) throw Object.assign(new Error('NotFound'), { name: 'NotFound' })
      return { ContentType: 'application/vnd.apple.mpegurl', ContentLength: 10 }
    }
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

const portal = await import('../server/services/media-portal.ts')
const { buildYouTubeThumbnailUpstreamUrl } = await import('../server/utils/youtube-parser.ts')
const {
  normalizeAssetPath, resolveMediaDirectory, resolveStreamTarget, resolveThumbnailTarget,
  MEDIA_STREAM_MANIFEST_PATH, MANIFEST_CACHE_SECONDS, SEGMENT_CACHE_SECONDS,
} = portal

// ─── Fake DB: one `select … where … limit` shape, real `where` compiled ──────
type Row = {
  id: number, slug: string, shortId: string, source: string, youtubeVideoId: string | null,
  storagePath: string | null, storageProvider: string, status: string, resolutionsReady: unknown
}
const dialect = new MySqlDialect()
let rows: Row[] = []
const lookups: string[] = []
const fakeDb = {
  select: () => ({
    from: () => ({
      where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => ({
        limit: async () => {
          const query = dialect.sqlToQuery(condition)
          const bySlug = /`slug`/.test(query.sql)
          lookups.push(bySlug ? 'slug' : 'short_id')
          const key = query.params[0]
          return rows.filter(row => (bySlug ? row.slug : row.shortId) === key).slice(0, 1)
        },
      }),
    }),
  }),
}

const HEX = '0123456789abcdef0123456789abcdef'
const videoR2 = { accountId: HEX, accessKeyId: 'AKIA', secretAccessKey: 'secret', bucket: 'video-bucket', publicUrl: 'https://cdn.example.com' }
let workdir = ''
const localConfig = () => ({ workdir, videoStorage: { provider: 'local' } }) as never
const r2Config = () => ({ workdir, videoStorage: { provider: 'r2', r2: videoR2 } }) as never

const item = (over: Partial<Row> = {}): Row => ({
  id: 1, slug: 'clip', shortId: 'abc123', source: 'upload', youtubeVideoId: null,
  storagePath: 'media/clip', storageProvider: 'local', status: 'published', resolutionsReady: ['360p'],
  ...over,
})
const put = (relative: string, content = 'x') => {
  const file = path.join(workdir, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
  return file
}
const stream = (assetPath: unknown, config = localConfig(), lookupSlug = false, shortId = 'abc123') =>
  resolveStreamTarget(shortId, assetPath, { db: fakeDb as never, config, lookupSlug })
const thumb = (config = localConfig(), lookupSlug = false, shortId = 'abc123') =>
  resolveThumbnailTarget(shortId, { db: fakeDb as never, config, lookupSlug })

before(() => { workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-asset-targets-')) })
after(() => { rmSync(workdir, { recursive: true, force: true }) })
beforeEach(() => {
  rmSync(path.join(workdir, 'media'), { recursive: true, force: true })
  rows = [item()]
  lookups.length = 0
  s3.sent = []
  s3.keys = []
  s3.listFails = false
})

// ─── Path helpers ─────────────────────────────────────────────────────────────

describe('normalizeAssetPath', () => {
  it('drops `..`/`.`/empty segments and backslashes instead of refusing', () => {
    assert.equal(normalizeAssetPath('../../etc/passwd'), 'etc/passwd')
    assert.equal(normalizeAssetPath('a\\..\\b'), 'a/b')
    assert.equal(normalizeAssetPath('./360p//seg0.ts'), '360p/seg0.ts')
    assert.equal(normalizeAssetPath(`  ${MEDIA_STREAM_MANIFEST_PATH}  `), MEDIA_STREAM_MANIFEST_PATH)
  })

  it('returns null for non-strings, blank or all-dot input, and over 512 characters', () => {
    for (const value of [42, null, undefined, {}, '', '   ', '..', '/./../']) {
      assert.equal(normalizeAssetPath(value), null, JSON.stringify(value))
    }
    assert.equal(normalizeAssetPath('a'.repeat(512)), 'a'.repeat(512))
    assert.equal(normalizeAssetPath('a'.repeat(513)), null)
  })
})

describe('resolveMediaDirectory', () => {
  it('uses storage_path, strips `/generations/…` back to the base folder, falls back to media/<slug>', () => {
    const config = localConfig() as { workdir: string }
    const media = path.join(config.workdir, 'media')
    assert.equal(resolveMediaDirectory(config as never, { slug: 'clip', storagePath: 'media/abc' }), path.join(media, 'abc'))
    assert.equal(resolveMediaDirectory(config as never, { slug: 'clip', storagePath: '  media/abc/generations/g1  ' }), path.join(media, 'abc'))
    assert.equal(resolveMediaDirectory(config as never, { slug: 'clip', storagePath: null }), path.join(media, 'clip'))
    assert.equal(resolveMediaDirectory(config as never, { slug: 'clip', storagePath: '   ' }), path.join(media, 'clip'))
  })

  it('refuses anything that is not strictly inside <workdir>/media/', () => {
    const config = localConfig()
    for (const storagePath of ['../../etc', 'media', 'media/', 'mediax/abc', '/etc/passwd', 'media/../uploads/x']) {
      assert.equal(resolveMediaDirectory(config, { slug: 'clip', storagePath }), null, storagePath)
    }
  })
})

// ─── Stream target: local disk ────────────────────────────────────────────────

describe('resolveStreamTarget — local disk', () => {
  it('serves the HLS manifest with the short manifest cache when renditions exist', async () => {
    const file = put('media/clip/master.m3u8', '#EXTM3U')
    assert.deepEqual(await stream(MEDIA_STREAM_MANIFEST_PATH), {
      kind: 'local', filePath: file, contentType: 'application/vnd.apple.mpegurl', size: 7,
      cacheSeconds: MANIFEST_CACHE_SECONDS, attachment: false, passthrough: false,
    })
    assert.deepEqual(lookups, ['short_id'])
  })

  it('serves a segment with the long cache; a missing segment is null even when the original exists', async () => {
    const file = put('media/clip/360p/seg0.ts', 'seg')
    put('media/clip/original.mp4', 'orig')
    assert.deepEqual(await stream('360p/seg0.ts'), {
      kind: 'local', filePath: file, contentType: 'video/mp2t', size: 3,
      cacheSeconds: SEGMENT_CACHE_SECONDS, attachment: false, passthrough: false,
    })
    assert.equal(await stream('360p/seg9.ts'), null)
  })

  it('manifest not published yet but renditions listed → the original file, passthrough', async () => {
    const original = put('media/clip/original.mp4', 'orig')
    assert.deepEqual(await stream(MEDIA_STREAM_MANIFEST_PATH), {
      kind: 'local', filePath: original, contentType: 'video/mp4', size: 4,
      cacheSeconds: SEGMENT_CACHE_SECONDS, attachment: false, passthrough: true,
    })
  })

  it('no renditions (incl. the JSON string a raw driver returns) → the original, never a `.part`', async () => {
    rows = [item({ resolutionsReady: '[]' })]
    put('media/clip/master.m3u8', '#EXTM3U')
    put('media/clip/original.mp4.part', 'half')
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH), null, 'a half-uploaded original is never served')
    const original = put('media/clip/original.webm', 'orig')
    assert.deepEqual(await stream(MEDIA_STREAM_MANIFEST_PATH), {
      kind: 'local', filePath: original, contentType: 'video/webm', size: 4,
      cacheSeconds: SEGMENT_CACHE_SECONDS, attachment: false, passthrough: true,
    })
    rows = [item({ resolutionsReady: null })]
    assert.equal((await stream(MEDIA_STREAM_MANIFEST_PATH))?.passthrough, true)
  })

  it('a storage_path under /generations/<id> resolves assets inside that generation', async () => {
    rows = [item({ storagePath: 'media/clip/generations/g1' })]
    const file = put('media/clip/generations/g1/master.m3u8', '#EXTM3U')
    assert.equal((await stream(MEDIA_STREAM_MANIFEST_PATH) as { filePath: string }).filePath, file)
  })

  it('an unknown extension is served as an octet-stream attachment', async () => {
    put('media/clip/notes.bin', 'b')
    const target = await stream('notes.bin')
    assert.equal(target?.contentType, 'application/octet-stream')
    assert.equal(target?.attachment, true)
  })

  it('null for unpublished, external, escaping or empty paths — one indistinguishable answer', async () => {
    put('media/clip/master.m3u8', '#EXTM3U')
    put('etc/passwd', 'root')
    assert.equal(await stream('../../../etc/passwd'), null)
    assert.equal(await stream(''), null)
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH, localConfig(), false, 'unknown'), null)
    rows = [item({ status: 'draft' })]
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH), null)
    rows = [item({ source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ' })]
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH), null)
    rows = [item({ storagePath: '../outside' })]
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH), null)
  })

  it('looks up by slug only when asked to', async () => {
    put('media/clip/master.m3u8', '#EXTM3U')
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH, localConfig(), false, 'clip'), null)
    assert.ok(await stream(MEDIA_STREAM_MANIFEST_PATH, localConfig(), true, 'clip'))
    assert.deepEqual(lookups, ['short_id', 'slug'])
  })
})

// ─── Stream target: R2 ────────────────────────────────────────────────────────

describe('resolveStreamTarget — R2', () => {
  beforeEach(() => { rows = [item({ storageProvider: 'r2' })] })

  it('a segment maps to <storagePath>/<asset> without touching R2', async () => {
    assert.deepEqual(await stream('360p/seg0.ts', r2Config()), {
      kind: 'r2', r2Key: 'media/clip/360p/seg0.ts', contentType: 'video/mp2t', size: 0,
      cacheSeconds: SEGMENT_CACHE_SECONDS, attachment: false,
    })
    assert.deepEqual(s3.sent, [])
  })

  it('a published manifest is checked with HEAD and served with the manifest cache', async () => {
    s3.keys = ['media/clip/master.m3u8']
    assert.deepEqual(await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()), {
      kind: 'r2', r2Key: 'media/clip/master.m3u8', contentType: 'application/vnd.apple.mpegurl', size: 0,
      cacheSeconds: MANIFEST_CACHE_SECONDS, attachment: false,
    })
    assert.deepEqual(s3.sent.map(c => [c.name, c.input.Bucket, c.input.Key]), [['HeadObjectCommand', 'video-bucket', 'media/clip/master.m3u8']])
  })

  it('manifest missing on R2 → the original on R2, passthrough', async () => {
    s3.keys = ['media/clip/original.mov', 'media/clip/generations/g1/original.mp4']
    assert.deepEqual(await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()), {
      kind: 'r2', r2Key: 'media/clip/original.mov', contentType: 'video/quicktime', size: 0,
      cacheSeconds: SEGMENT_CACHE_SECONDS, attachment: false, passthrough: true,
    })
  })

  it('manifest and original missing on R2 → the original on local disk; nothing anywhere → null', async () => {
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()), null)
    const original = put('media/clip/original.mp4', 'orig')
    assert.deepEqual(await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()), {
      kind: 'local', filePath: original, contentType: 'video/mp4', size: 4,
      cacheSeconds: SEGMENT_CACHE_SECONDS, attachment: false, passthrough: true,
    })
  })

  it('no renditions → the original on R2 without a HEAD; R2 missing it → local; R2 down → local', async () => {
    rows = [item({ storageProvider: 'r2', resolutionsReady: [] })]
    s3.keys = ['media/clip/original.mkv']
    assert.deepEqual(await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()), {
      kind: 'r2', r2Key: 'media/clip/original.mkv', contentType: 'video/x-matroska', size: 0,
      cacheSeconds: SEGMENT_CACHE_SECONDS, attachment: false, passthrough: true,
    })
    assert.ok(!s3.sent.some(c => c.name === 'HeadObjectCommand'))

    s3.keys = []
    assert.equal(await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()), null)
    const original = put('media/clip/original.mp4', 'orig')
    assert.equal((await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()) as { filePath: string }).filePath, original)
    s3.listFails = true
    assert.equal((await stream(MEDIA_STREAM_MANIFEST_PATH, r2Config()) as { kind: string }).kind, 'local')
  })

  it('provider r2 in the row but no video R2 configured → the local branch', async () => {
    const file = put('media/clip/master.m3u8', '#EXTM3U')
    assert.equal((await stream(MEDIA_STREAM_MANIFEST_PATH, localConfig()) as { filePath: string }).filePath, file)
    assert.deepEqual(s3.sent, [])
  })

  it('provider r2 with an empty storage_path → null', async () => {
    rows = [item({ storageProvider: 'r2', storagePath: '  ' })]
    assert.equal(await stream('360p/seg0.ts', r2Config()), null)
  })
})

// ─── Thumbnail target ─────────────────────────────────────────────────────────

describe('resolveThumbnailTarget', () => {
  it('an external item resolves to the upstream URL; an invalid stored id to null', async () => {
    rows = [item({ source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ', storagePath: null })]
    assert.deepEqual(await thumb(), { kind: 'remote', url: buildYouTubeThumbnailUpstreamUrl('dQw4w9WgXcQ') })
    rows = [item({ source: 'youtube', youtubeVideoId: 'not a video id', storagePath: null })]
    assert.equal(await thumb(), null)
  })

  it('unpublished or unknown → null', async () => {
    put('media/clip/thumb.jpg', 'jpg')
    assert.equal(await thumb(localConfig(), false, 'unknown'), null)
    rows = [item({ status: 'archived' })]
    assert.equal(await thumb(), null)
  })

  it('local: the root thumb.jpg first, else the NEWEST generations/<claim>/thumb.jpg, else null', async () => {
    assert.equal(await thumb(), null)
    // Chọn theo mtime, không theo tên hay độ dài: bản mới nhất mang tên dài hơn.
    const newest = put('media/clip/generations/aaaa-long-claim/thumb.jpg', 'new')
    const stale = put('media/clip/generations/b/thumb.jpg', 'stale')
    utimesSync(newest, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'))
    utimesSync(stale, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    assert.deepEqual(await thumb(), { kind: 'local', filePath: newest, contentType: 'image/jpeg', size: 3 })
    const root = put('media/clip/thumb.jpg', 'root!')
    assert.deepEqual(await thumb(), { kind: 'local', filePath: root, contentType: 'image/jpeg', size: 5 })
  })

  it('R2: the root key wins over deeper ones; otherwise the shallowest deeper key', async () => {
    rows = [item({ storageProvider: 'r2' })]
    s3.keys = ['media/clip/generations/g1/thumb.jpg', 'media/clip/thumb.jpg']
    assert.deepEqual(await thumb(r2Config()), { kind: 'r2', r2Key: 'media/clip/thumb.jpg' })
    s3.keys = ['media/clip/generations/old-claim/retry/thumb.jpg', 'media/clip/generations/g1/thumb.jpg', 'media/clip/generations/g1/360p/seg0.ts']
    assert.deepEqual(await thumb(r2Config()), { kind: 'r2', r2Key: 'media/clip/generations/g1/thumb.jpg' })
    assert.deepEqual(s3.sent.at(-1)?.input, { Bucket: 'video-bucket', Prefix: 'media/clip', ContinuationToken: undefined, MaxKeys: 1000 })
  })

  it('R2 without a thumb, R2 down, or no video R2 configured → the local file; nothing → null', async () => {
    rows = [item({ storageProvider: 'r2' })]
    s3.keys = ['media/clip/360p/seg0.ts']
    assert.equal(await thumb(r2Config()), null)
    const root = put('media/clip/thumb.jpg', 'root')
    const local = { kind: 'local', filePath: root, contentType: 'image/jpeg', size: 4 }
    assert.deepEqual(await thumb(r2Config()), local)
    s3.listFails = true
    assert.deepEqual(await thumb(r2Config()), local)
    const sentBefore = s3.sent.length
    assert.deepEqual(await thumb(localConfig()), local)
    assert.equal(s3.sent.length, sentBefore, 'no R2 call without a video R2 config')
  })

  it('looks up by slug only when asked to', async () => {
    put('media/clip/thumb.jpg', 'jpg')
    assert.equal(await thumb(localConfig(), false, 'clip'), null)
    assert.ok(await thumb(localConfig(), true, 'clip'))
    assert.deepEqual(lookups, ['short_id', 'slug'])
  })
})

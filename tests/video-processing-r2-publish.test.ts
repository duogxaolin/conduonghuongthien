/**
 * Giai đoạn 7 của đường ống chuyển mã — đồng bộ cây công bố lên R2 — nhánh
 * THÀNH CÔNG.
 *
 * Nhánh hỏng chạy không cần mock ở `tests/media-processing.test.ts` (account id
 * sai bị `openR2` từ chối trước khi có request nào). Nhánh thành công cần một R2
 * thật, nên `video-r2-sync` bị thay bằng `mock.module`. Mock khoá theo **URL đã
 * phân giải** của module, nên nó có hiệu lực bất kể tệp nào trong nhóm
 * `video-processing` gọi `syncDirectoryToR2` — điều phải còn đúng sau khi tách
 * `video-processing.ts` thành nhiều tệp (wave2 5.4). Viết trước lượt tách, chạy
 * xanh trên tệp gốc.
 *
 * Ba điều được khẳng định, cả ba đều im lặng khi hỏng:
 *   • cây được đồng bộ là cây **đã có ảnh đại diện** — tức là lượt đồng bộ chạy
 *     SAU giai đoạn 5; chạy trước thì R2 thiếu `thumb.jpg` và cổng công khai rơi
 *     về ảnh giữ chỗ cho mọi video;
 *   • hàng mang `storage_provider = 'r2'`;
 *   • cây local bị xoá (R2 là nguồn chính) — giữ lại thì đĩa VPS đầy dần.
 *
 * Cơ sở dữ liệu ở đây là một kho giả **một hàng**, không phải bảng giả có bộ đọc
 * SQL như `media-processing.test.ts`: lượt chạy chỉ có một mục, và điều cần kiểm
 * là giá trị cuối cùng trên hàng, không phải mệnh đề `WHERE`.
 */
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

type SyncCall = { localDir: string, prefix: string, files: string[] }
const syncCalls: SyncCall[] = []

async function listTree(root: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...await listTree(root, rel))
    else out.push(rel)
  }
  return out.sort()
}

const unused = (name: string) => async () => { throw new Error(`${name} không được gọi trong test này`) }

// Đủ mọi tên `server/**` import từ `video-r2-sync` (đồ thị import của đường ống
// đi qua `chunked-upload` → `media-asset-cleanup`), không thì liên kết module hỏng.
mock.module(new URL('../server/services/video-r2-sync.ts', import.meta.url), {
  namedExports: {
    syncDirectoryToR2: async (localDir: string, prefix: string) => {
      const files = await listTree(localDir)
      syncCalls.push({ localDir, prefix, files })
      return { files: files.length, bytes: 1 }
    },
    deleteR2Tree: unused('deleteR2Tree'),
    listR2Keys: unused('listR2Keys'),
    locateR2Original: unused('locateR2Original'),
    streamR2Object: unused('streamR2Object'),
    streamR2ObjectRange: unused('streamR2ObjectRange'),
    headR2Object: unused('headR2Object'),
    putR2Object: unused('putR2Object'),
  },
})

// Import động SAU `mock.module` (import tĩnh được hoist, sẽ nạp module thật).
const { processMediaItem } = await import('../server/services/video-processing.ts')
const { MEDIA_DEFAULTS } = await import('../server/utils/media-config.ts')
type ProcessRunner = import('../server/services/video-processing.ts').ProcessRunner
type MediaConfig = import('../server/utils/media-config.ts').MediaConfig

const workdir = await mkdtemp(path.join(tmpdir(), 'cdkt-r2-publish-'))
after(() => rm(workdir, { recursive: true, force: true }))

/** Kho một hàng: `select` trả hàng (hoặc rỗng cho lượt đếm việc đang chạy), `update` gộp vào hàng. */
function singleRowStore(row: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    select: (projection?: unknown) => ({
      from: () => ({
        where: () => ({ limit: async () => (projection ? [] : [{ ...row }]) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values)
          Object.assign(row, values)
          return Promise.resolve([{ affectedRows: 1 }])
        },
      }),
    }),
  }
  const pool = {
    getConnection: async () => ({
      query: async (sql: string) => (/GET_LOCK/i.test(sql) ? [[{ acquired: 1 }], []] : [[{ released: 1 }], []]),
      release() {},
    }),
  }
  return { db, pool, updates }
}

/** Runner giả sinh đúng những tệp FFmpeg sẽ sinh: một bản 360p + ảnh đại diện. */
const runner: ProcessRunner = async (command, args) => {
  if (command === 'ffprobe') {
    return {
      code: 0,
      stdout: JSON.stringify({ format: { duration: '12' }, streams: [{ codec_type: 'video', width: 640, height: 360 }] }),
      stderr: '',
    }
  }
  const segmentAt = args.indexOf('-hls_segment_filename')
  if (segmentAt !== -1) {
    const outputDir = path.dirname(args[segmentAt + 1]!)
    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'seg_000.ts'), 'segment')
    await writeFile(path.join(outputDir, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n')
    return { code: 0, stdout: '', stderr: '' }
  }
  const output = args[args.length - 1]!
  if (output.endsWith('.jpg')) await writeFile(output, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))
  return { code: 0, stdout: '', stderr: '' }
}

test('đồng bộ R2 thành công: cây đủ cả ảnh đại diện được đẩy lên, hàng mang `r2`, cây local bị xoá', async () => {
  const slug = 'phim-r2'
  const sourceDir = path.join(workdir, 'media', slug)
  await mkdir(sourceDir, { recursive: true })
  const size = Buffer.alloc(4)
  size.writeUInt32BE(24)
  await writeFile(path.join(sourceDir, 'original.mp4'), Buffer.concat([size, Buffer.from('ftypisom'), Buffer.alloc(64)]))

  const row: Record<string, unknown> = {
    id: 7, slug, source: 'upload', processingStatus: 'pending', processingAttempts: 0,
    processingNextAttemptAt: null, storagePath: null, resolutionsReady: [], claimedBy: null,
  }
  const store = singleRowStore(row)
  const config: MediaConfig = {
    ...MEDIA_DEFAULTS,
    uploadEnabled: true,
    workdir,
    diskFloorBytes: 0,
    processingMaxAttempts: 1,
    autoTranscode: true,
    processingCpuLimit: 100,
    videoStorage: {
      provider: 'r2',
      r2: { accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'videos', publicUrl: 'https://cdn.example.test' },
    },
  }

  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (value: unknown) => { lines.push(String(value)) }
  console.error = (value: unknown) => { lines.push(String(value)) }
  let result
  try {
    result = await processMediaItem({ mediaItemId: 7 }, { db: store.db as never, pool: store.pool as never, config, run: runner })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  assert.deepEqual(result, { ok: true, slug, renditions: ['360p'] })
  assert.match(String(row.storagePath), /^media\/phim-r2\/generations\/[a-f0-9]{8}:[a-f0-9-]{36}$/)
  assert.equal(syncCalls.length, 1, 'đồng bộ đúng một lượt')
  assert.deepEqual(syncCalls[0], {
    localDir: path.resolve(workdir, String(row.storagePath)),
    prefix: String(row.storagePath),
    files: ['360p/index.m3u8', '360p/seg_000.ts', 'master.m3u8', 'thumb.jpg'],
  })
  assert.equal(row.storageProvider, 'r2')
  assert.equal(row.processingStatus, 'ready')
  assert.equal(row.claimedBy, null)
  await assert.rejects(access(path.resolve(workdir, String(row.storagePath))), 'cây local phải bị xoá khi R2 là nguồn chính')
  assert.ok(lines.some(line => line.includes('"media.r2_synced"')), 'phải log media.r2_synced')
  assert.ok(!lines.some(line => line.includes('"media.r2_sync_failed"')))
})

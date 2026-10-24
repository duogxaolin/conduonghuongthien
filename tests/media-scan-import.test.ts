/**
 * Quét `public/uploads/` → hàng `media` (wave2 D-SCAN), với CSDL / R2 giả và tệp thật.
 *
 * Bản cũ:
 *   - biết "tệp này đã nhập" chỉ qua `storage_path`. Tệp nhập lên R2 có `storage_path`
 *     là KHOÁ R2 (`2026/10/a.png`), không phải đường dẫn tệp → lượt quét sau nhập lại
 *     đúng tệp đó, mỗi lượt thêm một hàng `media` trùng;
 *   - tải lên R2 theo khoá `YYYY/MM/<tên tệp>` mà không hỏi khoá đó đã thuộc hàng nào:
 *     `2026/09/a.png` và `2026/10/a.png` cùng ra một khoá, tệp sau ghi ĐÈ ảnh của hàng
 *     trước (hai hàng một object — xoá một hàng là mất ảnh của hàng kia);
 *   - ghi hàng hỏng sau khi đã tải lên → object R2 mồ côi, không hàng nào trỏ tới.
 *
 * Nay: ghi `scanned_source_path` (đường dẫn tương đối với gốc uploads) cho mọi tệp
 * nhập; tập "đã biết" = `scanned_source_path` của mọi hàng + `storage_path` của hàng
 * local; trước khi tải lên hỏi `otherRowOwns` → trùng khoá là `conflict`, không tải,
 * không ghi; ghi hàng hỏng → xoá object vừa tải + log.
 *
 * Tệp được tạo trong một thư mục tạm làm cwd (`<tmp>/public/uploads/…`) — lượt quét
 * đọc đúng đường dẫn sản xuất đọc, không đụng `public/uploads` của bản checkout.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

import { activityLogs, media } from '../server/db/schema.ts'

type MediaRow = {
  id: number
  filename: string
  provider: string
  url: string
  storagePath: string
  scannedSourcePath: string | null
  sizeBytes: number
}

const dialect = new MySqlDialect()
const store = {
  media: [] as MediaRow[],
  audits: [] as Array<Record<string, unknown>>,
  nextId: 1,
  /** Tên tệp mà lượt ghi hàng `media` sẽ hỏng. */
  failInsertFor: new Set<string>(),
  /** Tên tệp mà hàng đã commit nhưng nơi gọi vẫn nhận lỗi (kết nối rơi lúc COMMIT). */
  commitThenFailFor: new Set<string>(),
  uploads: [] as Array<{ filename: string; key: string }>,
  deletes: [] as string[],
}

function columnsOf(fields: Record<string, unknown> | undefined, row: MediaRow): Record<string, unknown> {
  if (!fields) return { ...row }
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(fields)) out[name] = (row as unknown as Record<string, unknown>)[name]
  return out
}

const fakeDb = {
  select: (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      assert.equal(table, media, 'the scan only reads `media`')
      return Promise.resolve(store.media.map(row => columnsOf(fields, row)))
    },
  }),
  // `otherRowOwns`: SELECT id FROM media WHERE id <> ? AND provider = ? AND storage_path = ? LIMIT 1
  execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
    const { sql, params } = dialect.sqlToQuery(query)
    assert.match(sql, /from `media` where \(`media`\.`id` <> \? and `media`\.`provider` = \? and `media`\.`storage_path` = \?\)/i, `unexpected execute: ${sql}`)
    const [id, provider, storagePath] = params as [number, string, string]
    return [store.media.filter(r => r.id !== id && r.provider === provider && r.storagePath === storagePath).map(r => ({ id: r.id })), []]
  },
  insert: (table: unknown) => ({
    values: async (values: Record<string, unknown>) => {
      assert.equal(table, activityLogs, 'only audit rows are written outside a transaction')
      store.audits.push(values)
    },
  }),
  // Nhận hàng R2 cũ (W3): UPDATE media SET scanned_source_path = ? WHERE id = ? AND scanned_source_path IS NULL
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (cond: Parameters<typeof dialect.sqlToQuery>[0]) => {
        assert.equal(table, media)
        assert.deepEqual(Object.keys(values), ['scannedSourcePath'], 'the claim writes the source path only')
        const { sql, params } = dialect.sqlToQuery(cond)
        assert.match(sql, /`media`\.`id` = \? and `media`\.`scanned_source_path` is null/i, `unexpected claim: ${sql}`)
        const row = store.media.find(r => r.id === params[0] && r.scannedSourcePath === null)
        if (row) row.scannedSourcePath = String(values.scannedSourcePath)
        return [{ affectedRows: row ? 1 : 0 }, []]
      },
    }),
  }),
  transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const pendingMedia: MediaRow[] = []
    const pendingAudits: Array<Record<string, unknown>> = []
    const tx = {
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          if (table === media) {
            if (store.failInsertFor.has(String(values.filename))) throw new Error(`Deadlock found when trying to get lock (${String(values.filename)})`)
            const row: MediaRow = {
              id: store.nextId++,
              filename: String(values.filename),
              provider: String(values.provider),
              url: String(values.url),
              storagePath: String(values.storagePath),
              scannedSourcePath: (values.scannedSourcePath as string | undefined) ?? null,
              sizeBytes: Number(values.sizeBytes),
            }
            if (store.commitThenFailFor.has(row.filename)) {
              store.media.push(row) // the row DID commit…
              throw new Error('Connection lost: The server closed the connection.') // …but the caller sees an error
            }
            pendingMedia.push(row)
            return [{ insertId: row.id, affectedRows: 1 }, []]
          }
          assert.equal(table, activityLogs)
          pendingAudits.push(values)
          return [{ insertId: 0, affectedRows: 1 }, []]
        },
      }),
    }
    const result = await work(tx)
    store.media.push(...pendingMedia)
    store.audits.push(...pendingAudits)
    return result
  },
}

const fakePool = {
  getConnection: async () => ({
    query: async (sql: string) => (sql.includes('GET_LOCK') ? [[{ acquired: 1 }]] : [[]]),
    release: () => undefined,
  }),
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: { getDb: () => fakeDb, getPool: () => fakePool },
})

// R2 giả: khoá theo tháng cố định, như `r2ObjectKeyFor` thật trong cùng một tháng.
const R2_MONTH = '2026/10'
mock.module(new URL('../server/utils/media-r2.ts', import.meta.url), {
  namedExports: {
    r2ObjectKeyFor: (filename: string) => `${R2_MONTH}/${filename}`,
    uploadR2File: async (_buffer: Buffer, filename: string) => {
      const key = `${R2_MONTH}/${filename}`
      store.uploads.push({ filename, key })
      return { url: `https://cdn.test/${key}`, storagePath: key }
    },
    deleteR2File: async (key: string) => { store.deletes.push(key); return true },
    headR2Object: async () => true,
    getR2Object: async () => Buffer.from('x'),
  },
})
const r2Config = { accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket', publicUrl: 'https://cdn.test' }
mock.module(new URL('../server/services/media.ts', import.meta.url), {
  namedExports: { loadR2Config: async () => r2Config },
})

const logged: Array<Record<string, unknown>> = []
mock.method(console, 'error', (line: unknown) => {
  try { logged.push(JSON.parse(String(line)) as Record<string, unknown>) } catch { /* not a log line */ }
})
mock.method(console, 'log', (line: unknown) => {
  try { logged.push(JSON.parse(String(line)) as Record<string, unknown>) } catch { /* not a log line */ }
})

const scan = await import('../server/services/media-scan.ts')

// PNG magic + một ít byte: đủ để nhận là ảnh (sharp đọc hỏng thì vẫn nhập, không kích thước).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really a png body')])

const workdir = await mkdtemp(path.join(tmpdir(), 'cdkt-scan-'))
const originalCwd = process.cwd()
process.chdir(workdir)
const uploads = path.join(workdir, 'public', 'uploads')
after(async () => {
  process.chdir(originalCwd)
  await rm(workdir, { recursive: true, force: true })
})

async function writeFiles(files: Record<string, Buffer | string>) {
  await rm(uploads, { recursive: true, force: true })
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(uploads, rel)), { recursive: true })
    await writeFile(path.join(uploads, rel), body)
  }
}

function reset() {
  store.media = []
  store.audits = []
  store.nextId = 1
  store.failInsertFor = new Set()
  store.commitThenFailFor = new Set()
  store.uploads = []
  store.deletes = []
}

/** Chạy một lượt quét tới hết (theo dõi qua trạng thái, như trang quản trị). */
async function runScan(autoRepointToR2: boolean) {
  await scan.startScanJob(1, { autoRepointToR2 })
  for (let i = 0; i < 400; i += 1) {
    const status = scan.getScanJobStatus()
    if (status && !status.running) return status
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail('the scan did not finish')
}

test('quét lần hai không nhập lại tệp đã nhập lên R2 (và tệp đã nhập local)', async () => {
  reset()
  await writeFiles({ '2026/09/mot.png': PNG, '2026/10/hai.png': PNG, 'ghi-chu.txt': 'không phải ảnh' })
  const first = await runScan(true)
  assert.equal(first.phase, 'done', first.message)
  assert.equal(first.imported, 2, JSON.stringify({ status: first, log: logged.slice(-5) }))
  assert.equal(store.media.length, 2)
  assert.deepEqual(store.media.map(r => [r.provider, r.storagePath, r.scannedSourcePath]).sort(), [
    ['r2', `${R2_MONTH}/hai.png`, '2026/10/hai.png'],
    ['r2', `${R2_MONTH}/mot.png`, '2026/09/mot.png'],
  ], 'nguồn được ghi là đường dẫn tương đối với gốc uploads, không phải đường dẫn tuyệt đối của máy chủ')

  const second = await runScan(true)
  assert.equal(second.imported, 0, 'lượt hai không nhập lại tệp nào')
  assert.equal(store.media.length, 2, 'không hàng media mới')
  assert.equal(store.uploads.length, 2, 'không tải lên R2 lần nữa')

  // Lượt local: tệp đã có hàng local (storage_path tuyệt đối) cũng không nhập lại.
  reset()
  await writeFiles({ '2026/09/ba.png': PNG })
  assert.equal((await runScan(false)).imported, 1)
  assert.equal(store.media[0]!.scannedSourcePath, '2026/09/ba.png')
  assert.equal((await runScan(false)).imported, 0)
  assert.equal(store.media.length, 1)
})

test('cùng tên tệp ở hai thư mục ra cùng khoá R2: tệp sau là xung đột, không tải đè, không ghi hàng', async () => {
  reset()
  // Một hàng có sẵn sở hữu khoá của c.png (ảnh khác, cùng tên, đã ở R2).
  store.media.push({ id: 99, filename: 'c.png', provider: 'r2', url: `https://cdn.test/${R2_MONTH}/c.png`, storagePath: `${R2_MONTH}/c.png`, scannedSourcePath: null, sizeBytes: 5 })
  store.nextId = 100
  await writeFiles({ '2026/09/a.png': PNG, '2026/10/a.png': PNG, '2026/08/c.png': PNG })
  const before = logged.length
  const status = await runScan(true)
  assert.equal(status.imported, 1, 'chỉ một a.png được nhập')
  assert.equal(status.conflicts, 2, 'a.png thứ hai và c.png là xung đột')
  assert.deepEqual(store.uploads.map(u => u.key), [`${R2_MONTH}/a.png`], 'không object nào bị tải đè')
  assert.deepEqual(store.media.map(r => r.id).sort((x, y) => x - y), [99, 100])
  assert.equal(store.deletes.length, 0)
  const conflicts = logged.slice(before).filter(l => l.event === 'media.scan_conflict')
  assert.deepEqual(conflicts.map(l => l.key).sort(), [`${R2_MONTH}/a.png`, `${R2_MONTH}/c.png`])
  assert.ok(conflicts.every(l => typeof l.source === 'string' && !path.isAbsolute(String(l.source))))
})

test('ghi hàng hỏng sau khi đã tải lên R2: object vừa tải bị xoá và lỗi được log', async () => {
  reset()
  await writeFiles({ '2026/10/d.png': PNG, '2026/10/e.png': PNG })
  store.failInsertFor = new Set(['d.png'])
  const before = logged.length
  const status = await runScan(true)
  assert.equal(status.imported, 1)
  assert.deepEqual(status.errors, ['d.png'])
  assert.deepEqual(store.media.map(r => r.filename), ['e.png'])
  assert.deepEqual(store.deletes, [`${R2_MONTH}/d.png`], 'object của hàng không ghi được bị xoá')
  const failed = logged.slice(before).filter(l => l.event === 'media.scan_insert_failed')
  assert.equal(failed.length, 1)
  assert.equal(failed[0]!.objectDeleted, true)
  assert.equal(failed[0]!.key, `${R2_MONTH}/d.png`)
  assert.match(String(failed[0]!.error), /Deadlock/)
})

test('ghi hàng báo lỗi nhưng hàng ĐÃ commit (kết nối rơi lúc COMMIT): object không bị xoá vì một hàng đang trỏ tới nó (W4)', async () => {
  reset()
  await writeFiles({ '2026/10/f.png': PNG })
  store.commitThenFailFor = new Set(['f.png'])
  const before = logged.length
  const status = await runScan(true)
  assert.deepEqual(status.errors, ['f.png'])
  assert.deepEqual(store.media.map(r => [r.filename, r.storagePath]), [['f.png', `${R2_MONTH}/f.png`]], 'the row that did commit points at the object')
  assert.deepEqual(store.deletes, [], 'the object a row points at is never deleted')
  const failed = logged.slice(before).filter(l => l.event === 'media.scan_insert_failed')
  assert.equal(failed.length, 1)
  assert.equal(failed[0]!.objectDeleted, false)
  assert.equal(failed[0]!.keptBecause, 'owned_by_row')
})

test('quét lần đầu sau bản vá: hàng R2 do lượt quét CŨ nhập (chưa có nguồn) cùng tên + kích thước là "đã nhập", và được ghi nguồn (W3)', async () => {
  reset()
  // Lượt quét cũ: nhập cu.png lên R2 (khoá theo THÁNG TẢI LÊN, không theo thư mục nguồn), không ghi nguồn.
  store.media.push(
    { id: 40, filename: 'cu.png', provider: 'r2', url: 'https://cdn.test/2026/08/cu.png', storagePath: '2026/08/cu.png', scannedSourcePath: null, sizeBytes: PNG.length },
    // Cùng tên, khác kích thước: ảnh khác — không phải bản đã nhập của tệp này.
    { id: 41, filename: 'khac.png', provider: 'r2', url: 'https://cdn.test/2026/08/khac.png', storagePath: '2026/08/khac.png', scannedSourcePath: null, sizeBytes: 999_999 },
  )
  store.nextId = 100
  await writeFiles({ '2026/09/cu.png': PNG, '2026/09/khac.png': PNG })
  const first = await runScan(true)
  assert.equal(first.legacyMatched, 1)
  assert.equal(first.imported, 1, 'only khac.png (other size) is imported')
  assert.deepEqual(store.uploads.map(u => u.filename), ['khac.png'], 'cu.png is not uploaded a second time')
  assert.equal(store.media.find(r => r.id === 40)!.scannedSourcePath, '2026/09/cu.png', 'the legacy row now records its source (sticky)')
  assert.equal(store.media.filter(r => r.filename === 'cu.png').length, 1)

  // Lượt sau nhận ra qua `scanned_source_path`, không cần đoán lại.
  const second = await runScan(true)
  assert.equal(second.imported, 0)
  assert.equal(second.legacyMatched, 0)

  // Chế độ chỉ-local cũng không nhập bản sao của tệp đã có trên R2.
  reset()
  store.media.push({ id: 40, filename: 'cu.png', provider: 'r2', url: 'https://cdn.test/2026/08/cu.png', storagePath: '2026/08/cu.png', scannedSourcePath: null, sizeBytes: PNG.length })
  await writeFiles({ '2026/09/cu.png': PNG })
  const local = await runScan(false)
  assert.equal(local.imported, 0)
  assert.equal(local.legacyMatched, 1)

  // Hai tệp nguồn cùng tên + kích thước, hai hàng cũ: mỗi tệp nhận MỘT hàng; tệp thứ ba thì không còn hàng nào để nhận.
  reset()
  store.media.push(
    { id: 50, filename: 'trung.png', provider: 'r2', url: 'https://cdn.test/2026/07/trung.png', storagePath: '2026/07/trung.png', scannedSourcePath: null, sizeBytes: PNG.length },
    { id: 51, filename: 'trung.png', provider: 'r2', url: 'https://cdn.test/2026/08/trung.png', storagePath: '2026/08/trung.png', scannedSourcePath: null, sizeBytes: PNG.length },
  )
  store.nextId = 100
  await writeFiles({ '2026/07/trung.png': PNG, '2026/08/trung.png': PNG, '2026/09/trung.png': PNG })
  const pairs = await runScan(true)
  assert.equal(pairs.legacyMatched, 2)
  assert.deepEqual(store.media.filter(r => r.id < 100).map(r => r.scannedSourcePath).sort(), ['2026/07/trung.png', '2026/08/trung.png'])
  assert.equal(pairs.imported, 1, 'the third file has no legacy row left and is imported')
})

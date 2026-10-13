/**
 * Hành vi của dịch vụ đồng bộ ảnh local ↔ R2, chạy với db/R2/đĩa giả.
 *
 * Viết TRƯỚC khi tách `media-sync.ts`: các khẳng định phải xanh trên cả mã cũ lẫn mới.
 * Chỉ import qua `media-sync.ts` (đường mà 4 endpoint dùng). Ba điều quan trọng nhất:
 *   - file local chỉ bị xoá khi R2 HeadObject xác nhận object có thật;
 *   - một file hỏng không sập cả lượt (vào `skipped` + `errors`);
 *   - URL trong bài viết chỉ được thay SAU khi sync xong, và chỉ khi có hàng đã sync.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { mock } from 'node:test'

// Timer pre-backup 90s trong worker không được giữ tiến trình test sống.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) => {
  const t = realSetTimeout(fn, ms, ...args)
  if (ms === 90_000) t.unref()
  return t
}) as typeof setTimeout

type Row = Record<string, unknown>
const rec = {
  items: [] as Row[],
  executes: 0,
  txUpdates: [] as Row[],
  audits: [] as Row[],
  deletedLocal: [] as string[],
  uploaded: [] as string[],
  headResult: true,
  backupFails: true,
  lockFree: true,
  r2Config: { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' } as Row,
}
function reset() {
  rec.items = []; rec.executes = 0; rec.txUpdates = []; rec.audits = []
  rec.deletedLocal = []; rec.uploaded = []; rec.headResult = true
  rec.backupFails = true; rec.lockFree = true
  rec.r2Config = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }
}

const fakeDb = {
  select: () => ({ from: () => ({ where: async () => rec.items }) }),
  insert: () => ({ values: async (v: Row) => { rec.audits.push(v) } }),
  execute: async () => { rec.executes++; return [{ affectedRows: 1 }] },
  transaction: async (fn: (tx: unknown) => Promise<void>) => {
    await fn({
      update: () => ({ set: (s: Row) => ({ where: async () => { rec.txUpdates.push(s) } }) }),
      insert: () => ({ values: async (v: Row) => { rec.audits.push(v) } }),
    })
  },
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: { getDb: () => fakeDb, getPool: () => ({}) },
})
mock.module(new URL('../server/services/media.ts', import.meta.url), {
  namedExports: { loadR2Config: async () => rec.r2Config },
})
mock.module(new URL('../server/services/backup.ts', import.meta.url), {
  namedExports: {
    runBackup: async () => {
      if (rec.backupFails) throw new Error('backup down')
      return { stamp: 'stamp-1' }
    },
  },
})
mock.module(new URL('../server/utils/media-r2.ts', import.meta.url), {
  namedExports: {
    uploadR2File: async (_b: Buffer, filename: string) => {
      rec.uploaded.push(filename)
      return { url: `https://cdn.test/${filename}`, storagePath: `2026/10/${filename}` }
    },
    deleteR2File: async () => undefined,
    getR2Object: async () => Buffer.from('x'),
    headR2Object: async () => rec.headResult,
  },
})
mock.module(new URL('../server/utils/media-local.ts', import.meta.url), {
  namedExports: {
    uploadLocalFile: async (_b: Buffer, filename: string) => ({ url: `/uploads/${filename}`, storagePath: `/tmp/${filename}` }),
    deleteLocalFile: async (p: string) => { rec.deletedLocal.push(p) },
  },
})
mock.module(new URL('../server/utils/named-lock.ts', import.meta.url), {
  namedExports: {
    withNamedLock: async (_p: unknown, _n: string, _t: number, fn: () => Promise<unknown>) =>
      rec.lockFree ? { acquired: true, value: await fn() } : { acquired: false },
  },
})

const svc = await import('../server/services/media-sync.ts')

const dir = mkdtempSync(join(tmpdir(), 'media-sync-'))
function localItem(id: number, filename: string, exists = true): Row {
  const storagePath = join(dir, filename)
  if (exists) writeFileSync(storagePath, 'img')
  return { id, filename, mimeType: 'image/png', provider: 'local', url: `/uploads/${filename}`, storagePath }
}

async function waitJob() {
  for (let i = 0; i < 400; i++) {
    if (svc.getSyncJobStatus()?.running === false) return svc.getSyncJobStatus()!
    await new Promise(r => realSetTimeout(r, 10))
  }
  throw new Error('job did not finish')
}

test('to-r2: file tốt được chuyển + xoá local; file hỏng vào skipped/errors; bài viết được thay URL', async () => {
  reset()
  rec.items = [localItem(1, 'a.png'), localItem(2, 'gone.png', false)]
  const { jobId } = await svc.startSyncJob('to-r2', 5)
  assert.match(jobId, /^sync_\d+$/)
  const s = await waitJob()
  assert.equal(s.phase, 'done')
  assert.equal(s.total, 2)
  assert.equal(s.done, 2)
  assert.equal(s.synced, 1)
  assert.equal(s.skipped, 1)
  assert.deepEqual(s.errors, ['gone.png'])
  assert.deepEqual(rec.uploaded, ['a.png'])
  assert.deepEqual(rec.deletedLocal, [rec.items[0]!.storagePath])
  assert.equal(rec.txUpdates[0]!.provider, 'r2')
  // 1 rewrite → 2 UPDATE content (REGEXP + REPLACE) + 1 UPDATE thumbnail, mỗi cái affected=1.
  assert.equal(rec.executes, 3)
  assert.equal(s.articlesRewritten, 3)
  assert.ok(rec.audits.some(a => a.action === 'sync_storage_batch'))
})

test('to-r2: R2 HeadObject 404 → GIỮ file local', async () => {
  reset()
  rec.headResult = false
  rec.items = [localItem(1, 'keep.png')]
  await svc.startSyncJob('to-r2', 5)
  const s = await waitJob()
  assert.equal(s.synced, 1)
  assert.deepEqual(rec.deletedLocal, [])
})

test('không có hàng nào sync được → không đụng articles', async () => {
  reset()
  rec.items = [localItem(1, 'gone.png', false)]
  await svc.startSyncJob('to-r2', 5)
  const s = await waitJob()
  assert.equal(s.synced, 0)
  assert.equal(rec.executes, 0)
  assert.equal(s.articlesRewritten, 0)
})

test('to-r2 mà R2 chưa cấu hình đủ → job failed với thông báo, không sync', async () => {
  reset()
  rec.r2Config = { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' }
  rec.items = [localItem(1, 'a.png')]
  await svc.startSyncJob('to-r2', 5)
  const s = await waitJob()
  assert.equal(s.phase, 'failed')
  assert.match(s.message, /Cloudflare R2 chưa đầy đủ/)
  assert.deepEqual(rec.uploaded, [])
})

test('không cho chạy hai job chồng nhau; forceReset gỡ kẹt', async () => {
  reset()
  rec.backupFails = false
  rec.items = [localItem(1, 'a.png')]
  await svc.startSyncJob('to-r2', 5)
  await assert.rejects(() => svc.startSyncJob('to-r2', 5), /đang chạy/)
  const forced = svc.forceResetSyncJob()
  assert.equal(forced.ok, true)
  assert.equal(svc.getSyncJobStatus()!.phase, 'cancelled')
  assert.equal(svc.getSyncJobStatus()!.running, false)
  assert.equal(svc.forceResetSyncJob().ok, false)
  await new Promise(r => realSetTimeout(r, 700)) // để worker nền cũ chạy hết
})

test('getSyncJobStatus trả bản sao', async () => {
  const a = svc.getSyncJobStatus()!
  a.errors.push('x')
  assert.ok(!svc.getSyncJobStatus()!.errors.includes('x'))
})

test('syncMediaStorage (đường đồng bộ cũ): chuyển file, tổng hợp kết quả, ghi audit tổng', async () => {
  reset()
  rec.items = [localItem(1, 'a.png'), localItem(2, 'gone.png', false)]
  const r = await svc.syncMediaStorage('to-r2', 5)
  assert.deepEqual(r, { synced: 1, skipped: 1, errors: ['gone.png'], articlesRewritten: 2 })
  assert.ok(rec.audits.some(a => a.action === 'sync_storage'))
})

test('syncMediaStorage: khoá bận → lỗi; R2 chưa cấu hình → lỗi', async () => {
  reset()
  rec.lockFree = false
  await assert.rejects(() => svc.syncMediaStorage('to-r2', 5), /đang chạy/)
  reset()
  rec.r2Config = { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' }
  await assert.rejects(() => svc.syncMediaStorage('to-r2', 5), /Cloudflare R2 chưa đầy đủ/)
})

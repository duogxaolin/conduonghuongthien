/**
 * Hành vi của dịch vụ đồng bộ ảnh local ↔ R2, chạy với db/R2/đĩa/khoá giả.
 *
 * Chỉ import qua `media-sync.ts` (đường mà 4 endpoint dùng). Mọi thao tác giả ghi
 * vào MỘT nhật ký sự kiện có thứ tự, để khẳng định THỨ TỰ chứ không chỉ số lượng:
 *   - bản cũ (file local / object R2) chỉ bị xoá SAU khi transaction đổi hàng +
 *     thay URL ở mọi nội dung đã commit — không bao giờ trước;
 *   - R2 HeadObject 404 → hàng, nội dung, file local đều không đổi;
 *   - lỗi giữa chừng trong transaction → rollback, không xoá gì; chạy lại thì xong;
 *   - huỷ giữa lượt: hàng đã xong giữ nguyên thành quả, hàng sau không bị chạm;
 *   - buộc dừng: worker cũ không ghi gì thêm, không ghi đè trạng thái job mới, và
 *     job mới không chạy chồng khi worker cũ còn giữ khoá;
 *   - trạng thái dở dang của mã cũ (hàng đã sang R2, nội dung còn URL local) được
 *     vá ở đầu lượt kế tiếp, kể cả khi không còn hàng local nào để đồng bộ.
 * Hành vi SQL thật (REPLACE trong JSON, dạng tuyệt đối) ở `media-sync-rewrite-integration.test.ts`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { mock } from 'node:test'

import { MySqlDialect } from 'drizzle-orm/mysql-core'

import * as schema from '../server/db/schema.ts'

const realSetTimeout = globalThis.setTimeout
const dialect = new MySqlDialect()

type Row = Record<string, unknown>
interface Gate { wait: Promise<void>; open: () => void }
function gate(): Gate {
  let open!: () => void
  const wait = new Promise<void>(resolve => { open = resolve })
  return { wait, open }
}

const rec = {
  items: [] as Row[],
  mediaRows: [] as Row[],
  auditTrail: [] as Row[],
  /** Văn bản giả theo cột tham chiếu, cho lượt quét của bước vá: `articles.content` → [...] */
  content: {} as Record<string, string[]>,
  events: [] as string[],
  /** Lượt chọn id ứng viên (bước 1 của lượt thay) — một mỗi cột tham chiếu. */
  scans: [] as { label: string; oldUrl: string; inTx: boolean }[],
  /** Câu UPDATE thật (bước 2) — chỉ ở cột có hàng ứng viên. */
  rewrites: [] as { label: string; oldUrl: string; newUrl: string; inTx: boolean }[],
  audits: [] as Row[],
  rowUpdates: [] as Row[],
  headResult: true,
  backupFails: true,
  backupGate: null as Gate | null,
  uploadGate: null as Gate | null,
  failRewriteOnce: false,
  rowUpdateAffected: 1,
  lockHeld: false,
  onDeleteLocal: null as null | ((p: string) => void),
  r2Config: { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' } as Row,
  /** Cột mà câu UPDATE "không sửa được" (mô phỏng chỗ lượt thay bỏ sót). */
  rewriteMisses: new Set<string>(),
  /** Lưới an toàn ném lỗi (CSDL hỏng giữa chừng). */
  remainingCheckFails: false,
  /** Chỗ lưu (storage_path / url) đang thuộc một hàng `media` KHÁC. */
  ownedByOther: new Set<string>(),
  /** Hàng `settings` mà `loadFaviconSetting` đọc. */
  settingsRows: [] as Row[],
  warnings: [] as Row[],
}
function reset() {
  Object.assign(rec, {
    items: [], mediaRows: [], auditTrail: [], content: {}, events: [], scans: [], rewrites: [], audits: [], rowUpdates: [],
    headResult: true, backupFails: true, backupGate: null, uploadGate: null, failRewriteOnce: false,
    rowUpdateAffected: 1, lockHeld: false, onDeleteLocal: null,
    r2Config: { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' },
    rewriteMisses: new Set<string>(), remainingCheckFails: false, ownedByOther: new Set<string>(), settingsRows: [], warnings: [],
  })
}

/** Gỡ `%…%` + thoát LIKE về chuỗi gốc. */
const unlike = (s: unknown) => String(s).slice(1, -1).replace(/\\(.)/g, '$1')
/** Mẫu MySQL (`(?-i)…`) chạy bằng engine JS — cùng cú pháp trừ cờ nội tuyến. */
const jsRegex = (p: unknown) => new RegExp(String(p).replace(/^\(\?-i\)/, ''), 'gu')

/**
 * Một kết quả truy vấn drizzle giả: chuỗi `.where().orderBy()` được, await được.
 * `filtered` là kết quả khi có `.where()` (với `media`: hàng cần sync theo hướng),
 * `list` khi không (với `media`: toàn bảng, cho bước vá).
 */
function rows(list: () => Row[], filtered: () => Row[] = list) {
  const q = {
    where: () => rows(filtered),
    orderBy: () => q,
    then: (resolve: (v: Row[]) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(list()).then(resolve, reject),
  }
  return q
}

function makeExecutor(inTx: boolean) {
  return async (query: Parameters<MySqlDialect['sqlToQuery']>[0]) => {
    const { sql, params } = dialect.sqlToQuery(query)
    if (/^select/i.test(sql)) {
      // Chỗ lưu có thuộc hàng `media` khác không (trước upload / trước khi xoá).
      if (/ from `media` /i.test(sql)) {
        const owned = params.slice(2).some(p => rec.ownedByOther.has(String(p)))
        return [owned ? [{ id: 999 }] : [], []]
      }
      // Lượt quét của bước vá: phân trang theo id.
      const scan = /CAST\(`(\w+)`\.`(\w+)` AS CHAR\) AS v/i.exec(sql)
      if (scan) {
        const label = `${scan[1]}.${scan[2]}`
        const after = /> \?/.test(sql) ? Number(params[0]) : 0
        const limit = Number(params.at(-1))
        const texts = rec.content[label] ?? []
        const page = texts.map((v, i) => ({ id: i + 1, v })).filter(r => r.id > after).slice(0, limit)
        return [page, []]
      }
      const m = / from `(\w+)` where \(?`\w+`\.`(\w+)` LIKE/i.exec(sql)
      const label = m ? `${m[1]}.${m[2]}` : '?'
      const texts = rec.content[label] ?? []
      // Lưới an toàn: cặp (LIKE, REGEXP) cho mỗi dạng URL.
      if (/ REGEXP /.test(sql)) {
        if (rec.remainingCheckFails) throw new Error('db down')
        const patterns = params.filter((_, i) => i % 2 === 1)
        const hit = texts.some(t => patterns.some(p => jsRegex(p).test(t)))
        return [hit ? [{ id: 1 }] : [], []]
      }
      // Bước 1 của lượt thay: id các hàng có thể chứa URL cũ.
      const likes = params.map(unlike)
      rec.scans.push({ label, oldUrl: likes[0]!, inTx })
      rec.events.push(`scan:${label}`)
      return [texts.flatMap((t, i) => (likes.some(l => t.includes(l)) ? [{ id: i + 1 }] : [])), []]
    }
    const m = /^UPDATE `(\w+)` SET `\w+`\.`(\w+)`/.exec(sql)
    const label = m ? `${m[1]}.${m[2]}` : '?'
    if (rec.failRewriteOnce && inTx) {
      rec.failRewriteOnce = false
      rec.events.push('rewrite-error')
      throw new Error('Timeout exceeded in regular expression match.')
    }
    // params: [mẫu, chuỗi thay, …id, LIKE]
    const pattern = params[0]
    const replacement = String(params[1]).replace(/\\(.)/g, '$1')
    const ids = new Set(params.slice(2, -1).map(Number))
    const oldUrl = unlike(params.at(-1))
    rec.rewrites.push({ label, oldUrl, newUrl: replacement, inTx })
    rec.events.push(`rewrite:${label}`)
    if (rec.rewriteMisses.has(label)) return [{ affectedRows: 0 }, undefined]
    const texts = rec.content[label] ?? []
    let affected = 0
    rec.content[label] = texts.map((t, i) => {
      if (!ids.has(i + 1)) return t
      const next = t.replace(jsRegex(pattern), () => replacement)
      if (next !== t) affected += 1
      return next
    })
    return [{ affectedRows: affected }, undefined]
  }
}

const fakeDb = {
  select: () => ({
    from: (table: unknown) => {
      if (table === schema.media) return rows(() => [...rec.mediaRows, ...rec.items], () => rec.items)
      if (table === schema.activityLogs) return rows(() => rec.auditTrail)
      if (table === schema.settings) return rows(() => rec.settingsRows)
      return rows(() => [])
    },
  }),
  insert: () => ({ values: async (v: Row) => { rec.audits.push({ ...v, inTx: false }); rec.events.push(`audit:${String(v.action)}`) } }),
  execute: makeExecutor(false),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    rec.events.push('tx-begin')
    const staged: Row[] = []
    const tx = {
      update: () => ({
        set: (s: Row) => ({
          where: async () => {
            rec.events.push('row-update')
            staged.push(s)
            return [{ affectedRows: rec.rowUpdateAffected }, undefined]
          },
        }),
      }),
      insert: () => ({ values: async (v: Row) => { staged.push({ audit: { ...v, inTx: true } }); rec.events.push(`tx-audit:${String(v.action)}`) } }),
      execute: makeExecutor(true),
    }
    try {
      const out = await fn(tx)
      for (const s of staged) {
        if (s.audit) rec.audits.push(s.audit as Row)
        else rec.rowUpdates.push(s)
      }
      rec.events.push('commit')
      return out
    } catch (err) {
      rec.events.push('rollback')
      throw err
    }
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
      if (rec.backupGate) await rec.backupGate.wait
      if (rec.backupFails) throw new Error('backup down')
      return { stamp: 'stamp-1' }
    },
    // `pre-job-backup.ts` imports the class; the restore case is `media-jobs-restore-abort.test.ts`.
    BackupRestoreInProgressError: class BackupRestoreInProgressError extends Error {},
  },
})
mock.module(new URL('../server/utils/media-r2.ts', import.meta.url), {
  namedExports: {
    r2ObjectKeyFor: (filename: string) => `2026/10/${filename}`,
    uploadR2File: async (_b: Buffer, filename: string) => {
      rec.events.push(`upload:${filename}`)
      if (rec.uploadGate) await rec.uploadGate.wait
      return { url: `https://cdn.test/2026/10/${filename}`, storagePath: `2026/10/${filename}` }
    },
    deleteR2File: async (key: string) => { rec.events.push(`delete-r2:${key}`) },
    getR2Object: async () => Buffer.from('x'),
    headR2Object: async () => { rec.events.push('head'); return rec.headResult },
    // Kiểm cấu hình lúc dùng là việc của tests/r2-config-use-time.test.ts; ở đây R2 là giả.
    assertUsableR2Config: () => ({ accountId: 'a', bucket: 'b' }),
  },
})
mock.module(new URL('../server/utils/media-local.ts', import.meta.url), {
  namedExports: {
    localUploadTargetFor: (filename: string) => ({ url: `/uploads/2026/10/${filename}`, storagePath: `/tmp/${filename}` }),
    uploadLocalFile: async (_b: Buffer, filename: string) => {
      rec.events.push(`write-local:${filename}`)
      return { url: `/uploads/2026/10/${filename}`, storagePath: `/tmp/${filename}` }
    },
    deleteLocalFile: async (p: string) => {
      rec.events.push(`delete-local:${p.split('/').pop()}`)
      rec.onDeleteLocal?.(p)
    },
  },
})
mock.module(new URL('../server/utils/named-lock.ts', import.meta.url), {
  namedExports: {
    withNamedLock: async (_p: unknown, _n: string, _t: number, fn: () => Promise<unknown>) => {
      if (rec.lockHeld) return { acquired: false }
      rec.lockHeld = true
      try { return { acquired: true, value: await fn() } } finally { rec.lockHeld = false }
    },
  },
})

const svc = await import('../server/services/media-sync.ts')
const { URL_REFERENCE_TARGETS } = await import('../server/services/media-sync-rewrite.ts')
const { loadFaviconSetting } = await import('../server/utils/favicon-setting.ts')

const dir = mkdtempSync(join(tmpdir(), 'media-sync-'))
function localItem(id: number, filename: string, exists = true): Row {
  const storagePath = join(dir, filename)
  if (exists) writeFileSync(storagePath, 'img')
  return { id, filename, mimeType: 'image/png', provider: 'local', url: `/uploads/2026/10/${filename}`, storagePath }
}

async function waitJob(jobId?: string) {
  for (let i = 0; i < 600; i++) {
    const s = svc.getSyncJobStatus()
    if (s && s.running === false && (!jobId || s.jobId === jobId)) return s
    await new Promise(r => realSetTimeout(r, 10))
  }
  throw new Error('job did not finish')
}
async function until(cond: () => boolean) {
  for (let i = 0; i < 600; i++) {
    if (cond()) return
    await new Promise(r => realSetTimeout(r, 5))
  }
  throw new Error('condition never held')
}
/** jobId là `sync_<Date.now()>`: hai job liền nhau cần khác mili-giây. */
const tick = () => new Promise(r => realSetTimeout(r, 3))

/** Mọi cột tham chiếu — lấy từ chính danh sách của dịch vụ (gồm settings, chat, phiên bản trang…). */
const ALL_TARGETS = URL_REFERENCE_TARGETS.map(t => t.label)

test('to-r2: thay URL ở mọi bảng tham chiếu TRONG transaction đổi hàng, rồi mới xoá local', async () => {
  reset()
  rec.items = [localItem(1, 'a.png'), localItem(2, 'gone.png', false)]
  rec.content['articles.content'] = ['<p><img src="/uploads/2026/10/a.png"></p>']
  const { jobId } = await svc.startSyncJob('to-r2', 5)
  assert.match(jobId, /^sync_\d+$/)
  const s = await waitJob(jobId)
  assert.equal(s.phase, 'done')
  assert.equal(s.total, 2)
  assert.equal(s.done, 2)
  assert.equal(s.synced, 1)
  assert.equal(s.skipped, 1)
  assert.deepEqual(s.errors, ['gone.png'])
  assert.equal(s.articlesRewritten, 1)

  // Mọi cột tham chiếu được dò, cùng URL cũ, và tất cả trong transaction; chỉ cột
  // có hàng chứa URL mới bị UPDATE.
  const itemScans = rec.scans.filter(r => r.oldUrl === '/uploads/2026/10/a.png')
  assert.deepEqual([...new Set(itemScans.map(r => r.label))].sort(), [...ALL_TARGETS].sort())
  assert.ok(itemScans.every(r => r.inTx))
  const itemRewrites = rec.rewrites.filter(r => r.oldUrl === '/uploads/2026/10/a.png')
  assert.deepEqual([...new Set(itemRewrites.map(r => r.label))], ['articles.content'])
  assert.ok(itemRewrites.every(r => r.inTx && r.newUrl === 'https://cdn.test/2026/10/a.png'))
  assert.equal(rec.content['articles.content']![0], '<p><img src="https://cdn.test/2026/10/a.png"></p>')

  // Thứ tự: upload → head → row-update → dò/thay… → audit → commit → xoá local.
  const ev = rec.events
  const at = (e: string) => ev.indexOf(e)
  assert.ok(at('upload:a.png') < at('head'))
  assert.ok(at('head') < at('row-update'))
  assert.ok(at('row-update') < at('scan:articles.content'))
  assert.ok(at('scan:articles.content') < at('rewrite:articles.content'))
  assert.ok(ev.lastIndexOf(`scan:${ALL_TARGETS.at(-1)}`) < at('tx-audit:update'))
  assert.ok(at('tx-audit:update') < at('commit'))
  assert.ok(at('commit') < at('delete-local:a.png'), 'xoá local phải SAU commit của hàng + nội dung')
  assert.ok(!ev.includes('delete-local:gone.png'))

  assert.equal(rec.rowUpdates[0]!.provider, 'r2')
  const rowAudit = rec.audits.find(a => a.inTx && a.resourceId === 1)!
  assert.deepEqual(
    { sync: (rowAudit.meta as Row).sync, oldUrl: (rowAudit.meta as Row).oldUrl, rewritesApplied: (rowAudit.meta as Row).rewritesApplied },
    { sync: 'to-r2', oldUrl: '/uploads/2026/10/a.png', rewritesApplied: true },
  )
  assert.ok(rec.audits.some(a => a.action === 'sync_storage_batch'))
})

test('to-r2: R2 HeadObject 404 → hàng, nội dung, file local đều không đổi', async () => {
  reset()
  rec.headResult = false
  rec.items = [localItem(1, 'keep.png')]
  const { jobId } = await svc.startSyncJob('to-r2', 5)
  const s = await waitJob(jobId)
  assert.equal(s.synced, 0)
  assert.equal(s.skipped, 1)
  assert.deepEqual(s.errors, ['keep.png'])
  assert.ok(!rec.events.includes('row-update'), 'không đổi hàng sang URL R2 chưa xác nhận')
  assert.equal(rec.rewrites.length, 0)
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')))
})

test('lỗi giữa transaction (sau upload, trước khi thay xong URL) → rollback, giữ local; chạy lại thì hoàn tất', async () => {
  reset()
  rec.items = [localItem(1, 'crash.png')]
  rec.content['page_blocks.data'] = ['{"imageUrl": "/uploads/2026/10/crash.png"}']
  rec.failRewriteOnce = true
  const first = await svc.startSyncJob('to-r2', 5)
  const s1 = await waitJob(first.jobId)
  assert.equal(s1.synced, 0)
  assert.equal(s1.skipped, 1)
  assert.ok(rec.events.includes('rollback'))
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')), 'không xoá local khi URL chưa được thay')
  assert.equal(rec.rowUpdates.length, 0, 'hàng không đổi khi transaction rollback')

  // Hàng vẫn `local` (rollback) nên lượt sau chọn lại nó và làm trọn.
  rec.events = []
  await tick()
  const second = await svc.startSyncJob('to-r2', 5)
  const s2 = await waitJob(second.jobId)
  assert.equal(s2.synced, 1)
  assert.equal(rec.content['page_blocks.data']![0], '{"imageUrl": "https://cdn.test/2026/10/crash.png"}')
  assert.ok(rec.events.indexOf('commit') < rec.events.indexOf('delete-local:crash.png'))
})

test('hàng đã bị đổi bởi người khác trong lúc sync (0 hàng khớp) → rollback, không xoá local', async () => {
  reset()
  rec.items = [localItem(1, 'raced.png')]
  rec.rowUpdateAffected = 0
  const { jobId } = await svc.startSyncJob('to-r2', 5)
  const s = await waitJob(jobId)
  assert.equal(s.skipped, 1)
  assert.equal(rec.rewrites.length, 0, 'không thay URL khi hàng không còn như lúc đọc')
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')))
})

test('huỷ giữa lượt: hàng đã xong giữ nguyên thành quả, hàng sau không bị chạm', async () => {
  reset()
  rec.items = [localItem(1, 'one.png'), localItem(2, 'two.png'), localItem(3, 'three.png')]
  rec.onDeleteLocal = (p) => { if (p.endsWith('one.png')) svc.cancelSyncJob() }
  const { jobId } = await svc.startSyncJob('to-r2', 5)
  const s = await waitJob(jobId)
  assert.equal(s.phase, 'cancelled')
  assert.equal(s.done, 1)
  assert.equal(s.synced, 1)
  assert.ok(rec.scans.some(r => r.oldUrl === '/uploads/2026/10/one.png'), 'hàng đã xong đã đi qua lượt thay URL')
  assert.ok(!rec.events.includes('upload:two.png') && !rec.events.includes('upload:three.png'))
})

test('buộc dừng khi worker treo ở pre-backup: job mới không chạy chồng, worker cũ không ghi gì thêm', async () => {
  reset()
  rec.backupFails = false
  rec.backupGate = gate()
  rec.items = [localItem(1, 'slow.png')]
  const old = await svc.startSyncJob('to-r2', 5)
  await assert.rejects(() => svc.startSyncJob('to-r2', 5), /đang chạy/)
  await until(() => rec.lockHeld)

  const forced = svc.forceResetSyncJob()
  assert.equal(forced.ok, true)
  assert.equal(svc.getSyncJobStatus()!.phase, 'cancelled')
  assert.equal(svc.getSyncJobStatus()!.running, false)
  assert.equal(svc.forceResetSyncJob().ok, false)

  // Worker cũ còn giữ khoá → job mới thất bại rõ ràng thay vì chạy song song.
  await tick()
  const blocked = await svc.startSyncJob('to-r2', 5)
  const sb = await waitJob(blocked.jobId)
  assert.equal(sb.phase, 'failed')
  assert.match(sb.message, /giữ khoá/)

  // Worker cũ tỉnh lại: thấy mình đã bị thay → không upload, không đổi hàng, và
  // không ghi đè trạng thái job đang hiển thị.
  rec.backupGate.open()
  await until(() => !rec.lockHeld)
  assert.ok(!rec.events.some(e => e.startsWith('upload:')), 'worker cũ không được chạy tiếp')
  assert.equal(rec.rowUpdates.length, 0)
  assert.equal(svc.getSyncJobStatus()!.jobId, blocked.jobId)
  assert.equal(svc.getSyncJobStatus()!.phase, 'failed')
  assert.notEqual(old.jobId, blocked.jobId)

  // Khoá đã nhả → lượt mới chạy bình thường.
  rec.backupGate = null
  await tick()
  const fresh = await svc.startSyncJob('to-r2', 5)
  const sf = await waitJob(fresh.jobId)
  assert.equal(sf.phase, 'done')
  assert.equal(sf.synced, 1)
})

test('buộc dừng khi worker treo giữa lượt tải R2 của một hàng: hàng đó không được ghi', async () => {
  reset()
  rec.uploadGate = gate()
  rec.items = [localItem(1, 'hang.png'), localItem(2, 'next.png')]
  await svc.startSyncJob('to-r2', 5)
  await until(() => rec.events.includes('upload:hang.png'))
  svc.forceResetSyncJob()
  rec.uploadGate.open()
  await until(() => !rec.lockHeld)
  assert.ok(!rec.events.includes('row-update'), 'không mở transaction sau khi đã bị thay')
  assert.equal(rec.rewrites.length, 0)
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')), 'không xoá local của hàng chưa commit')
  assert.ok(!rec.events.includes('upload:next.png'))
})

test('vá trạng thái dở dang của mã cũ ở đầu lượt — kể cả khi không còn hàng local nào', async () => {
  reset()
  // Mã cũ: hàng đã sang R2 (audit cùng transaction) nhưng chết trước Phase 3 —
  // bài viết + bản dịch + khối trang còn trỏ file local đã bị xoá.
  rec.mediaRows = [{ id: 7, url: 'https://cdn.test/2026/09/old.png', provider: 'r2' }]
  rec.auditTrail = [{ resourceId: 7, meta: { sync: 'to-r2', oldUrl: '/uploads/2026/09/old.png', newUrl: 'https://cdn.test/2026/09/old.png' } }]
  rec.content['articles.content'] = ['<img src="http://localhost:3000/uploads/2026/09/old.png">', '<p>khác</p>']
  rec.content['article_translations.content'] = ['<img src="/uploads/2026/09/old.png">']
  const { jobId } = await svc.startSyncJob('to-r2', 5)
  const s = await waitJob(jobId)
  assert.equal(s.phase, 'done')
  assert.equal(s.total, 0)
  assert.equal(s.urlsRepaired, 1)
  const scanned = rec.scans.filter(r => r.oldUrl === '/uploads/2026/09/old.png')
  assert.deepEqual([...new Set(scanned.map(r => r.label))].sort(), [...ALL_TARGETS].sort())
  const repaired = rec.rewrites.filter(r => r.oldUrl === '/uploads/2026/09/old.png')
  assert.deepEqual([...new Set(repaired.map(r => r.label))].sort(), ['article_translations.content', 'articles.content'])
  assert.ok([...scanned, ...repaired].every(r => r.inTx))
  assert.ok(repaired.every(r => r.newUrl === 'https://cdn.test/2026/09/old.png'))
  assert.equal(rec.content['articles.content']![0], '<img src="https://cdn.test/2026/09/old.png">')
  assert.equal(rec.content['article_translations.content']![0], '<img src="https://cdn.test/2026/09/old.png">')
  assert.ok(rec.audits.some(a => a.inTx && (a.meta as Row)?.syncRepair === true && a.resourceId === 7))

  // Chạy lại: không còn gì trỏ URL cũ → không thay gì nữa (idempotent).
  rec.rewrites = []
  await tick()
  const again = await svc.startSyncJob('to-r2', 5)
  const s2 = await waitJob(again.jobId)
  assert.equal(s2.urlsRepaired, 0)
  assert.equal(rec.rewrites.length, 0)
})

test('to-r2 mà R2 chưa cấu hình đủ → job failed với thông báo, không sync', async () => {
  reset()
  rec.r2Config = { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' }
  rec.items = [localItem(1, 'a.png')]
  const { jobId } = await svc.startSyncJob('to-r2', 5)
  const s = await waitJob(jobId)
  assert.equal(s.phase, 'failed')
  assert.match(s.message, /Cloudflare R2 chưa đầy đủ/)
  assert.ok(!rec.events.some(e => e.startsWith('upload:')))
})

test('to-local: xoá object R2 chỉ sau commit của hàng + nội dung', async () => {
  reset()
  rec.items = [{ id: 4, filename: 'r.png', mimeType: 'image/png', provider: 'r2', url: 'https://cdn.test/2026/09/r.png', storagePath: '2026/09/r.png' }]
  // `r.png.webp` là ảnh KHÁC — không được bị kéo theo.
  rec.content['articles.content'] = ['<img src="https://cdn.test/2026/09/r.png"><img src="https://cdn.test/2026/09/r.png.webp">']
  const { jobId } = await svc.startSyncJob('to-local', 5)
  const s = await waitJob(jobId)
  assert.equal(s.synced, 1)
  assert.equal(rec.scans.length, ALL_TARGETS.length)
  assert.ok(rec.scans.every(r => r.inTx && r.oldUrl === 'https://cdn.test/2026/09/r.png'))
  const rewrites = rec.rewrites.filter(r => !r.oldUrl.includes('\\/'))
  assert.deepEqual(rewrites.map(r => r.label), ['articles.content'])
  assert.ok(rewrites.every(r => r.inTx && r.newUrl === '/uploads/2026/10/r.png'))
  assert.equal(rec.content['articles.content']![0], '<img src="/uploads/2026/10/r.png"><img src="https://cdn.test/2026/09/r.png.webp">')
  assert.ok(rec.events.indexOf('commit') < rec.events.indexOf('delete-r2:2026/09/r.png'))
})

test('getSyncJobStatus trả bản sao', async () => {
  const a = svc.getSyncJobStatus()!
  a.errors.push('x')
  assert.ok(!svc.getSyncJobStatus()!.errors.includes('x'))
})

test('syncMediaStorage (đường đồng bộ cũ): cùng đơn vị nguyên tử từng hàng, ghi audit tổng', async () => {
  reset()
  rec.items = [localItem(1, 'a.png'), localItem(2, 'gone.png', false)]
  rec.content['articles.thumbnail_url'] = ['/uploads/2026/10/a.png']
  const r = await svc.syncMediaStorage('to-r2', 5)
  assert.deepEqual(r, { synced: 1, skipped: 1, errors: ['gone.png'], articlesRewritten: 1 })
  assert.equal(rec.content['articles.thumbnail_url']![0], 'https://cdn.test/2026/10/a.png')
  assert.ok(rec.events.indexOf('commit') < rec.events.indexOf('delete-local:a.png'))
  assert.ok(rec.audits.some(a => a.action === 'sync_storage'))
})

test('syncMediaStorage: khoá bận → lỗi; R2 chưa cấu hình → lỗi', async () => {
  reset()
  rec.lockHeld = true
  await assert.rejects(() => svc.syncMediaStorage('to-r2', 5), /đang chạy/)
  reset()
  rec.r2Config = { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' }
  await assert.rejects(() => svc.syncMediaStorage('to-r2', 5), /Cloudflare R2 chưa đầy đủ/)
})

// ─── Lưới an toàn trước khi xoá bản cũ, ranh giới URL, chỗ đích trùng tên ────────

/** Bắt các dòng log JSON mức warn/error (logger ghi ra `console.error`). */
function captureLogs() {
  const lines: Row[] = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try { lines.push(JSON.parse(String(line))) } catch { /* không phải dòng log JSON */ }
  })
  return { lines, restore: () => spy.mock.restore() }
}

test('settings (logo/favicon chọn từ thư viện) được thay URL; bộ đệm favicon bị xoá ngay sau commit', async () => {
  reset()
  rec.items = [localItem(1, 'logo.png')]
  rec.content['settings.value'] = ['/uploads/2026/10/logo.png', '{"items":[{"icon":"/uploads/2026/10/logo.png"}]}', 'Cổng']
  // Bộ đệm favicon đang giữ URL cũ (30 giây nếu không ai xoá).
  rec.settingsRows = [{ key: 'favicon_url', value: '/uploads/2026/10/logo.png' }]
  assert.equal((await loadFaviconSetting()).iconUrl, '/uploads/2026/10/logo.png')

  const r = await svc.syncMediaStorage('to-r2', 5)
  assert.equal(r.synced, 1)
  assert.deepEqual(rec.content['settings.value'], [
    'https://cdn.test/2026/10/logo.png', '{"items":[{"icon":"https://cdn.test/2026/10/logo.png"}]}', 'Cổng',
  ])
  assert.ok(rec.events.indexOf('commit') < rec.events.indexOf('delete-local:logo.png'))
  // CSDL giả giờ trả giá trị mới: đọc lại phải thấy ngay, không phải giá trị đệm cũ.
  rec.settingsRows = [{ key: 'favicon_url', value: 'https://cdn.test/2026/10/logo.png' }]
  assert.equal((await loadFaviconSetting()).iconUrl, 'https://cdn.test/2026/10/logo.png')
})

test('lưới an toàn: còn cột trỏ URL cũ sau lượt thay → GIỮ bản cũ, log media.sync_old_copy_kept_referenced', async () => {
  reset()
  rec.items = [localItem(1, 'kept.png')]
  rec.content['chat_messages.content'] = ['![ảnh](/uploads/2026/10/kept.png)']
  rec.rewriteMisses = new Set(['chat_messages.content'])
  const log = captureLogs()
  let r
  try { r = await svc.syncMediaStorage('to-r2', 5) } finally { log.restore() }
  assert.equal(r.synced, 1, 'hàng vẫn chuyển: mọi thứ khác đã trỏ bản mới')
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')), 'bản cũ còn được tham chiếu → không xoá')
  const kept = log.lines.find(l => l.event === 'media.sync_old_copy_kept_referenced')
  assert.ok(kept, 'phải log lý do giữ bản cũ')
  assert.deepEqual(kept.remaining, ['chat_messages.content'])
})

test('lưới an toàn ném lỗi → đóng an toàn: giữ bản cũ', async () => {
  reset()
  rec.items = [localItem(1, 'unsure.png')]
  rec.remainingCheckFails = true
  const log = captureLogs()
  try { assert.equal((await svc.syncMediaStorage('to-r2', 5)).synced, 1) } finally { log.restore() }
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')))
  assert.ok(log.lines.some(l => l.event === 'media.sync_old_copy_kept_referenced' && /db down/.test(String(l.error))))
})

test('ranh giới: `a.jpg` đồng bộ không kéo `a.jpg.webp` (tải lên hỏng, còn local) sang URL R2', async () => {
  reset()
  rec.items = [localItem(1, 'a.jpg'), localItem(2, 'a.jpg.webp', false)]
  const html = '<img src="/uploads/2026/10/a.jpg"><img src="/uploads/2026/10/a.jpg.webp">'
  rec.content['articles.content'] = [html]
  rec.content['articles.thumbnail_url'] = ['/uploads/2026/10/a.jpg.webp']
  rec.content['pages.published_blocks'] = ['[{"data":{"imageUrl":"/uploads/2026/10/a.jpg.webp"}}]']
  const r = await svc.syncMediaStorage('to-r2', 5)
  assert.deepEqual({ synced: r.synced, skipped: r.skipped }, { synced: 1, skipped: 1 })
  assert.equal(rec.content['articles.content']![0], '<img src="https://cdn.test/2026/10/a.jpg"><img src="/uploads/2026/10/a.jpg.webp">')
  assert.equal(rec.content['articles.thumbnail_url']![0], '/uploads/2026/10/a.jpg.webp')
  assert.equal(rec.content['pages.published_blocks']![0], '[{"data":{"imageUrl":"/uploads/2026/10/a.jpg.webp"}}]')
})

test('chỗ đích (YYYY/MM/<filename>) đã thuộc hàng khác → bỏ qua TRƯỚC khi tải lên, không ghi đè', async () => {
  reset()
  rec.items = [localItem(1, 'dup.png')]
  rec.ownedByOther = new Set(['2026/10/dup.png'])
  const r = await svc.syncMediaStorage('to-r2', 5)
  assert.deepEqual({ synced: r.synced, skipped: r.skipped, errors: r.errors }, { synced: 0, skipped: 1, errors: ['dup.png'] })
  assert.ok(!rec.events.includes('upload:dup.png'), 'không PUT đè object của hàng kia')
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')))

  // Chiều về local: đường dẫn/URL local đích đã thuộc hàng khác.
  reset()
  rec.items = [{ id: 4, filename: 'r.png', mimeType: 'image/png', provider: 'r2', url: 'https://cdn.test/2026/09/r.png', storagePath: '2026/09/r.png' }]
  rec.ownedByOther = new Set(['/uploads/2026/10/r.png'])
  const back = await svc.syncMediaStorage('to-local', 5)
  assert.equal(back.skipped, 1)
  assert.ok(!rec.events.includes('write-local:r.png'))
  assert.ok(!rec.events.some(e => e.startsWith('delete-r2')))
})

test('bản cũ dùng chung với một hàng `media` khác → giữ bản cũ', async () => {
  reset()
  const item = localItem(1, 'shared.png')
  rec.items = [item]
  rec.ownedByOther = new Set([String(item.storagePath)])
  const log = captureLogs()
  try { assert.equal((await svc.syncMediaStorage('to-r2', 5)).synced, 1) } finally { log.restore() }
  assert.ok(!rec.events.some(e => e.startsWith('delete-local')))
  assert.ok(log.lines.some(l => l.event === 'media.sync_old_copy_kept_referenced' && l.sharedWithOtherRow === true))
})

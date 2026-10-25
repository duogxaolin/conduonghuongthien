import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'

/**
 * Account id / bucket R2 ĐÃ LƯU được kiểm lúc DÙNG, không chỉ lúc lưu.
 *
 * Trang cài đặt chặn giá trị dị dạng lúc lưu, nhưng giá trị lưu trước bản vá đó
 * (hoặc ghi thẳng vào CSDL, hoặc đi theo bản khôi phục) từng được dùng nguyên văn:
 * `createR2Client` (ảnh) và client video dựng `https://${accountId}.r2.cloudflarestorage.com`,
 * nên account id `evil.example#` cho host `evil.example` — và SDK ký yêu cầu bằng
 * access key gửi tới đó. Nay mọi client đi qua `openR2`: sai → `R2ConfigInvalidError`
 * (400, có phân loại) + log `r2.config_invalid` (giới hạn tần suất), không dựng
 * endpoint nào. Các đường "không ném" của video giữ hợp đồng (null/false); các
 * đường ảnh mà `false` nghĩa là "object không tồn tại" (`headR2Object`) hay "đã
 * xoá" (`deleteR2File`) thì NÉM — không kiểm được khác với không tồn tại.
 */

const logs: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    logWarn: (entry: Record<string, unknown>) => { logs.push(entry) },
    logInfo: () => {},
    logError: () => {},
  },
})

// media-sync startup: database/lock/backup are fakes; the DB must never be touched
// when the stored R2 config is unusable.
const dbTouched: string[] = []
/** When set, the fake DB answers through it (self-heal test); otherwise any access throws. */
let dbImpl: Record<string, unknown> | null = null
const fakeDb = new Proxy({}, {
  get: (_t, prop) => {
    dbTouched.push(String(prop))
    if (dbImpl) return dbImpl[String(prop)]
    throw new Error(`db.${String(prop)} used`)
  },
})
let storedR2 = { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '', publicUrl: '' }
const locksTaken: string[] = []
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => ({}) } })
mock.module('../server/services/media', { namedExports: { loadR2Config: async () => storedR2 } })
mock.module('../server/services/backup', {
  namedExports: {
    runBackup: async () => ({ stamp: 'stamp-1' }),
    // `pre-job-backup.ts` imports the class; the restore case is `media-jobs-restore-abort.test.ts`.
    BackupRestoreInProgressError: class BackupRestoreInProgressError extends Error {},
  },
})
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_p: unknown, name: string, _t: number, fn: () => Promise<unknown>) => {
      locksTaken.push(name)
      return { acquired: true, value: await fn() }
    },
  },
})

const r2 = await import('../server/utils/media-r2')
const video = await import('../server/services/video-r2-sync')
const { R2ConfigInvalidError, r2ConfigProblem, openR2, createR2Client } = r2

const HEX = '0123456789abcdef0123456789abcdef'
const cfg = (accountId: string, bucket = 'media-bucket') => ({ accountId, accessKeyId: 'AKIA', secretAccessKey: 'secret', bucket, publicUrl: 'https://cdn.example.com' })

async function endpointHost(client: { config: { endpoint?: unknown } }): Promise<string> {
  const endpoint = await (client.config.endpoint as () => Promise<{ hostname: string }>)()
  return endpoint.hostname
}

test('account id table: only 32 hex (either case, surrounding whitespace trimmed) builds an endpoint', async () => {
  const accepted: Array<[string, string]> = [
    [HEX, HEX],
    [HEX.toUpperCase(), HEX.toUpperCase()],
    [`  ${HEX}\n`, HEX],
  ]
  for (const [input, trimmed] of accepted) {
    assert.equal(r2ConfigProblem(cfg(input)), null, JSON.stringify(input))
    const host = await endpointHost(createR2Client(cfg(input)))
    assert.equal(host.toLowerCase(), `${trimmed.toLowerCase()}.r2.cloudflarestorage.com`)
  }

  const rejected = [
    'evil.example#',
    'evil.example',
    `${HEX}.evil.example#`,
    `evil.example/${HEX}`,
    `user@evil.example#${HEX}`,
    HEX.slice(0, 31),
    `${HEX}0`,
    `${HEX.slice(0, 16)} ${HEX.slice(16, 31)}`,
    `${HEX.slice(0, 16)}\t${HEX.slice(16, 31)}`,
    'g'.repeat(32),
    '',
    '   ',
  ]
  for (const accountId of rejected) {
    assert.equal(r2ConfigProblem(cfg(accountId)), 'account_id', JSON.stringify(accountId))
    assert.throws(() => createR2Client(cfg(accountId)), (err: unknown) => {
      assert.ok(err instanceof R2ConfigInvalidError, JSON.stringify(accountId))
      assert.equal(err.statusCode, 400)
      assert.equal(err.code, 'R2_CONFIG_INVALID')
      assert.equal(err.field, 'account_id')
      if (accountId.trim()) assert.ok(!err.message.includes(accountId.trim()), 'the stored value is not echoed')
      return true
    })
  }
})

test('bucket table: DNS-label buckets pass (trimmed and used as the Bucket param); anything else is refused', () => {
  assert.equal(openR2(cfg(HEX, 'media-bucket')).bucket, 'media-bucket')
  assert.equal(openR2(cfg(HEX, ' media-bucket ')).bucket, 'media-bucket')
  for (const bucket of ['b', 'ab', 'evil.example', 'Bucket', 'a#b', 'x/y', '-abc', 'abc-', 'a'.repeat(64), '', 'my bucket']) {
    assert.equal(r2ConfigProblem(cfg(HEX, bucket)), 'bucket', bucket)
    assert.throws(() => openR2(cfg(HEX, bucket)), (err: unknown) => err instanceof R2ConfigInvalidError && err.field === 'bucket')
  }
})

test('h3 turns the classified error into a 400 with the Vietnamese message', async () => {
  const { createError } = await import('h3')
  try {
    createR2Client(cfg('evil.example#'))
    assert.fail('expected a throw')
  } catch (err: unknown) {
    const h3 = createError(err as Error)
    assert.equal(h3.statusCode, 400)
    assert.match(h3.statusMessage ?? '', /Account ID/)
    assert.match(h3.statusMessage ?? '', /media-storage/)
  }
})

test('image helpers refuse an unusable stored config instead of reporting "missing" / "deleted"', async () => {
  const bad = cfg('evil.example#')
  const isInvalid = (err: unknown) => err instanceof R2ConfigInvalidError
  await assert.rejects(r2.headR2Object('2026/10/a.jpg', bad), isInvalid, 'not `false` (= object missing)')
  await assert.rejects(r2.deleteR2File('2026/10/a.jpg', bad), isInvalid, 'not `false`/`true`')
  await assert.rejects(r2.getR2Object('2026/10/a.jpg', bad), isInvalid)
  await assert.rejects(r2.uploadR2File(Buffer.from('x'), 'a.jpg', 'image/jpeg', bad), isInvalid)
  await assert.rejects(r2.getR2BucketSize(bad), isInvalid)
  await assert.rejects(r2.headR2Object('k', cfg(HEX, 'evil.example')), isInvalid)
})

test('video helpers: throwing paths throw the classified error; never-throw paths keep their contract', async () => {
  const bad = cfg('evil.example#')
  const isVideoInvalid = (err: unknown) => err instanceof R2ConfigInvalidError && err.scope === 'video' && /media-portal/.test(err.message)
  await assert.rejects(video.streamR2Object('media/x/master.m3u8', bad), isVideoInvalid)
  await assert.rejects(video.streamR2ObjectRange('media/x/original.mp4', bad, 'bytes=0-1'), isVideoInvalid)
  await assert.rejects(video.deleteR2Tree('media/x', bad), isVideoInvalid)
  const dir = mkdtempSync(path.join(tmpdir(), 'cdkt-r2-video-'))
  try {
    writeFileSync(path.join(dir, 'master.m3u8'), '#EXTM3U')
    await assert.rejects(video.syncDirectoryToR2(dir, 'media/x', bad), isVideoInvalid)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(await video.listR2Keys('media/x', bad), null)
  assert.equal(await video.locateR2Original('media/x', bad), null)
  assert.equal(await video.headR2Object('media/x/thumb.jpg', bad), null)
  assert.equal(await video.putR2Object('media/x/thumb.jpg', Buffer.from('x'), 'image/jpeg', bad), false)
})

test('r2.config_invalid is logged without the value and at most once per scope/field per window', async () => {
  // Earlier tests already logged media/account_id etc.; a fresh field/scope pair
  // shows the throttle: many failures, one line.
  const videoBucketLines = () => logs.filter(e => e.event === 'r2.config_invalid' && e.scope === 'video' && e.field === 'bucket')
  assert.equal(videoBucketLines().length, 0)
  for (let i = 0; i < 25; i++) {
    assert.equal(await video.listR2Keys('media/x', cfg(HEX, 'Bad#Bucket')), null)
  }
  assert.equal(videoBucketLines().length, 1)
  for (const line of logs.filter(e => e.event === 'r2.config_invalid')) {
    assert.deepEqual(Object.keys(line).sort(), ['event', 'field', 'scope'])
  }
})

test('media sync stops up front (classified error, DB untouched) when the stored image R2 config is unusable', async () => {
  const sync = await import('../server/services/media-sync')
  storedR2 = cfg('evil.example#')

  // Legacy synchronous path: rejects before taking the lock or reading rows.
  await assert.rejects(sync.syncMediaStorage('to-local', 1), (err: unknown) => err instanceof R2ConfigInvalidError)
  assert.deepEqual(locksTaken, [])
  assert.deepEqual(dbTouched, [])

  // Background worker: the job ends `failed` with the classified message, no row touched.
  await sync.startSyncJob('to-r2', 1)
  for (let i = 0; i < 200 && sync.getSyncJobStatus()?.running; i++) await new Promise(r => setTimeout(r, 5))
  const status = sync.getSyncJobStatus()
  assert.equal(status?.running, false)
  assert.equal(status?.phase, 'failed')
  assert.match(status?.message ?? '', /Account ID/)
  assert.deepEqual(dbTouched, [], 'no media row was read or written')
})

test('media self-heal aborts on an unusable stored config instead of declaring every R2 object lost', async () => {
  // Before: `headR2Object` swallowed every error as `false` ("missing"), so a bad
  // stored config made self-heal mark each R2 row lost and step 3 rewrite their
  // URLs (and article thumbnails) to the default cover.
  const writes: string[] = []
  const r2Rows = [{ id: 7, filename: 'a.jpg', storagePath: '2026/10/a.jpg', url: 'https://cdn.example.com/2026/10/a.jpg', mimeType: 'image/jpeg', provider: 'r2' }]
  const selectChain = { from: () => ({ where: async () => r2Rows }) }
  dbImpl = {
    select: () => selectChain,
    update: () => { writes.push('update'); throw new Error('update must not run') },
    execute: () => { writes.push('execute'); throw new Error('execute must not run') },
    transaction: () => { writes.push('transaction'); throw new Error('transaction must not run') },
  }
  storedR2 = cfg('evil.example#')
  try {
    const { selfHealMedia } = await import('../server/services/media-self-heal')
    await assert.rejects(selfHealMedia(1), (err: unknown) => err instanceof R2ConfigInvalidError)
    assert.deepEqual(writes, [], 'no URL was rewritten')
  } finally {
    dbImpl = null
  }
})

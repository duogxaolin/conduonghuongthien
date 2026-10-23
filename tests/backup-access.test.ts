import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { EventEmitter, once } from 'node:events'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, type ReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Restore, download and deletion of a backup are super-admin only.
 *
 * A restore replaces every table (users and roles included) and a dump carries
 * password hashes and citizens' submissions, so a delegated `settings` grant must
 * not unlock them. Before this change `settings.update` was enough to restore
 * and `settings.read` enough to download the full dump.
 *
 * These tests RUN the four handlers with a fake event and the backup service
 * mocked, and assert two things for a settings editor: the response is 403, and
 * no service function (nor the multipart reader, nor the restore status) was
 * touched.
 */

const calls: string[] = []
const record = (name: string) => (..._args: unknown[]) => { calls.push(name); return Promise.resolve({ warning: null, legacyDateShift: false, preRestoreBackup: null }) }

/** Where the download handler looks — the real `backupsDir()` is `<cwd>/backups`. */
const backupDir = { current: path.resolve(process.cwd(), 'backups') }
mock.module('../server/services/backup', {
  namedExports: {
    deleteBackup: record('deleteBackup'),
    backupsDir: () => backupDir.current,
  },
})
mock.module('../server/services/backup-restore', {
  namedExports: {
    runRestore: record('runRestore'),
    restoreUploaded: record('restoreUploaded'),
    setRestoreStatusReceiving: () => { calls.push('setRestoreStatusReceiving') },
    setRestoreStatusFailed: () => { calls.push('setRestoreStatusFailed') },
  },
})

const warnings: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    logWarn: (entry: Record<string, unknown>) => { warnings.push(entry) },
    logInfo: () => {},
    logError: () => {},
    SECURITY_EVENTS: { backupRestoreRefused: 'backup.restore_refused', permissionDenied: 'auth.permission_denied' },
  },
})

const h3 = await import('h3')
type FakeEvent = {
  context: { adminUser: unknown }
  body?: unknown
  params?: Record<string, string>
  node?: { res: EventEmitter }
}
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = h3.createError
globals.readBody = async (event: FakeEvent) => { calls.push('readBody'); return event.body }
globals.readMultipartFormData = async () => { calls.push('readMultipartFormData'); return [{ name: 'file', filename: 'x.sql.gz', data: Buffer.from([0x1f, 0x8b]) }] }
globals.getRouterParam = (event: FakeEvent, name: string) => event.params?.[name]
let contentLength: string | undefined
globals.getRequestHeader = (_event: unknown, name: string) => (name === 'content-length' ? contentLength : undefined)
const headers: Record<string, unknown> = {}
globals.setHeader = (_event: unknown, name: string, value: unknown) => { calls.push('setHeader'); headers[name.toLowerCase()] = value }
/** What the handler hands to h3's `sendStream` — captured, not piped anywhere. */
const sent: Array<{ event: FakeEvent, stream: ReadStream }> = []
globals.sendStream = (event: FakeEvent, stream: ReadStream) => { sent.push({ event, stream }); return Promise.resolve() }

const { requireSuperAdmin, requireResourcePermission } = await import('../server/utils/permissions')

type Handler = (event: FakeEvent) => Promise<unknown>
const load = async (file: string) => (await import(`../server/api/admin/backup/${file}`)).default as Handler
const handlers = {
  restore: await load('restore.post.ts'),
  upload: await load('restore-upload.post.ts'),
  download: await load('[filename].get.ts'),
  remove: await load('[filename].delete.ts'),
}

const ALL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true }
const settingsEditor = { id: 9, username: 'settings-editor', isSuperAdmin: false, permissions: [{ resource: 'settings', ...ALL }] }
const settingsReader = { id: 10, username: 'settings-reader', isSuperAdmin: false, permissions: [{ resource: 'settings', canCreate: false, canRead: true, canUpdate: false, canDelete: false }] }
const superAdmin = { id: 1, username: 'admin', isSuperAdmin: true, permissions: [] }

function statusOf(fn: () => void): number | null {
  try { fn(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

async function asyncStatusOf(promise: Promise<unknown>): Promise<number | null> {
  try { await promise; return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

const eventFor = (adminUser: unknown): FakeEvent => ({
  context: { adminUser },
  body: { filename: 'cdkt-20261013T000000Z-manual.sql.gz' },
  params: { filename: 'cdkt-20261013T000000Z-manual.sql.gz' },
})

test('requireSuperAdmin: only a super-admin passes', () => {
  assert.equal(statusOf(() => requireSuperAdmin(superAdmin)), null)
  assert.equal(statusOf(() => requireSuperAdmin(settingsEditor)), 403, 'settings.update is not super-admin')
  assert.equal(statusOf(() => requireSuperAdmin(settingsReader)), 403, 'settings.read is not super-admin')
  assert.equal(statusOf(() => requireSuperAdmin(null)), 403, 'no actor')
  assert.equal(statusOf(() => requireSuperAdmin(undefined)), 403, 'no actor')
  assert.equal(statusOf(() => requireSuperAdmin({ id: 2, isSuperAdmin: null })), 403, 'a null flag is not super-admin')
  assert.equal(statusOf(() => requireSuperAdmin({ id: 2, isSuperAdmin: 'true' as unknown as boolean })), 403, 'only the boolean true counts')
  // The settings editor still passes the ordinary RBAC check — the new check is the one that decides.
  assert.equal(statusOf(() => requireResourcePermission(settingsEditor, 'settings', 'update')), null)
})

test('the refusal is a 403 with a Vietnamese message', () => {
  try {
    requireSuperAdmin(settingsEditor)
    assert.fail('should have thrown')
  } catch (error) {
    assert.equal((error as { statusCode: number }).statusCode, 403)
    assert.match((error as { statusMessage: string }).statusMessage, /SuperAdmin/)
  }
})

for (const [name, actor] of [['settings editor', settingsEditor], ['settings reader', settingsReader]] as const) {
  test(`a ${name} gets 403 on restore, upload-restore, download and delete — and nothing runs`, async () => {
    for (const [label, handler] of Object.entries(handlers)) {
      calls.length = 0
      warnings.length = 0
      assert.equal(await asyncStatusOf(handler(eventFor(actor))), 403, label)
      assert.deepEqual(calls, [], `${label}: ${calls.join(', ')} ran for a non-super-admin`)
    }
  })
}

test('upload-restore refuses before touching the restore status or reading the body, and logs the refusal', async () => {
  calls.length = 0
  warnings.length = 0
  assert.equal(await asyncStatusOf(handlers.upload(eventFor(settingsEditor))), 403)
  assert.ok(!calls.includes('setRestoreStatusReceiving'), 'the status banner must not flip to "receiving" for a refused caller')
  assert.ok(!calls.includes('readMultipartFormData'), 'the multipart body must not be read for a refused caller')
  assert.ok(warnings.some(entry => entry.event === 'backup.restore_refused' && entry.reason === 'not_super_admin' && entry.userId === 9))
})

test('an upload whose Content-Length exceeds the cap is refused with 413 before the body is read', async () => {
  calls.length = 0
  warnings.length = 0
  contentLength = String(600 * 1024 * 1024)
  try {
    assert.equal(await asyncStatusOf(handlers.upload(eventFor(superAdmin))), 413)
  } finally {
    contentLength = undefined
  }
  assert.ok(!calls.includes('setRestoreStatusReceiving'), 'the banner must not flip to "receiving"')
  assert.ok(!calls.includes('readMultipartFormData'), 'the oversized body must not be read into memory')
  assert.ok(!calls.includes('restoreUploaded'))
  assert.ok(calls.includes('setRestoreStatusFailed'))
  assert.ok(warnings.some(entry => entry.event === 'backup.restore_refused' && entry.reason === 'too_large'))
})

test('a super-admin reaches the service on every restricted action', async () => {
  calls.length = 0
  assert.equal(await asyncStatusOf(handlers.restore(eventFor(superAdmin))), null)
  assert.ok(calls.includes('runRestore'))
  calls.length = 0
  assert.equal(await asyncStatusOf(handlers.upload(eventFor(superAdmin))), null)
  assert.deepEqual(calls, ['setRestoreStatusReceiving', 'readMultipartFormData', 'restoreUploaded'])
  calls.length = 0
  assert.equal(await asyncStatusOf(handlers.remove(eventFor(superAdmin))), null)
  assert.deepEqual(calls, ['deleteBackup'])
  // Download: the permission gate passes; the file does not exist in the test cwd, so 404.
  assert.equal(await asyncStatusOf(handlers.download(eventFor(superAdmin))), 404)
})

// ─── Download streams the file (wave1 D12) ────────────────────────────────────
//
// `fs.readFile` loaded the whole archive into memory: a media archive above
// 2 GiB failed outright (Node's Buffer limit) and smaller ones cost their size in
// RAM per download. Now: `lstat` → regular file or 404, `Content-Length`, an
// RFC 5987 `Content-Disposition`, and `sendStream(createReadStream(path))`, with
// the stream destroyed when the response closes (h3's `sendStream` only calls
// `stream.abort`, which a file stream does not have).

function withBackupDir(run: (dir: string) => Promise<void>) {
  return async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cdkt-backup-download-'))
    const dir = path.join(root, 'backups')
    mkdirSync(dir)
    const previous = backupDir.current
    backupDir.current = dir
    sent.length = 0
    for (const key of Object.keys(headers)) delete headers[key]
    try {
      await run(dir)
    } finally {
      // Close every stream (it opens its file asynchronously) before the directory goes.
      for (const { stream } of sent) {
        if (stream.closed) continue
        stream.on('error', () => {})
        const closed = once(stream, 'close')
        stream.destroy()
        await closed
      }
      backupDir.current = previous
      rmSync(root, { recursive: true, force: true })
    }
  }
}

const downloadEvent = (filename: string): FakeEvent & { node: { res: EventEmitter } } => ({
  context: { adminUser: superAdmin },
  params: { filename },
  node: { res: new EventEmitter() },
})

async function readAll(stream: ReadStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

test('download: a backup file is streamed from disk with Content-Length and an RFC 5987 filename', withBackupDir(async (dir) => {
  const name = 'cdkt-20261023T030000Z-scheduled.sql.gz'
  const body = Buffer.from('gzip bytes '.repeat(4096))
  writeFileSync(path.join(dir, name), body)

  await handlers.download(downloadEvent(name))

  assert.equal(sent.length, 1, 'the handler must hand a stream to sendStream, not return a buffer')
  const { stream } = sent[0]!
  assert.equal(stream.path, path.join(dir, name), 'the stream reads the requested file')
  assert.equal(Number(headers['content-length']), body.length)
  const disposition = String(headers['content-disposition'])
  assert.match(disposition, /^attachment; filename="cdkt-20261023T030000Z-scheduled\.sql\.gz"; filename\*=UTF-8''cdkt-20261023T030000Z-scheduled\.sql\.gz$/)
  assert.equal(headers['content-type'], 'application/gzip')
  assert.deepEqual(await readAll(stream), body)
}))

test('download: the RFC 5987 filename* percent-encodes everything outside attr-char', withBackupDir(async (dir) => {
  // Not a name the app writes, but the header must stay well-formed for any name in the directory.
  const name = "bản sao (1)'*.tar.gz"
  writeFileSync(path.join(dir, name), 'x')
  await handlers.download(downloadEvent(name))
  const disposition = String(headers['content-disposition'])
  assert.match(disposition, /filename\*=UTF-8''b%E1%BA%A3n%20sao%20%281%29%27%2A\.tar\.gz$/)
  assert.doesNotMatch(disposition.split('; filename*=')[0]!, /[^\x20-\x7e]/, 'the plain filename= fallback is ASCII only')
}))

test('download: a name that resolves to a directory or a symlink is 404, and nothing is streamed', withBackupDir(async (dir) => {
  mkdirSync(path.join(dir, 'cdkt-uploads-20261023T030000Z-manual.tar.gz'))
  assert.equal(await asyncStatusOf(handlers.download(downloadEvent('cdkt-uploads-20261023T030000Z-manual.tar.gz'))), 404)
  const { symlinkSync } = await import('node:fs')
  const outside = path.join(path.dirname(dir), 'outside.txt')
  writeFileSync(outside, 'not a backup')
  symlinkSync(outside, path.join(dir, 'cdkt-20261023T030000Z-manual.sql.gz'))
  assert.equal(await asyncStatusOf(handlers.download(downloadEvent('cdkt-20261023T030000Z-manual.sql.gz'))), 404)
  assert.equal(await asyncStatusOf(handlers.download(downloadEvent('missing.sql.gz'))), 404)
  assert.equal(sent.length, 0)
}))

test('download: the file stream is destroyed when the response closes early', withBackupDir(async (dir) => {
  const name = 'cdkt-media-20261023T030000Z-manual.tar.gz'
  writeFileSync(path.join(dir, name), Buffer.alloc(256 * 1024))
  const event = downloadEvent(name)
  await handlers.download(event)
  const { stream } = sent[0]!
  assert.equal(stream.destroyed, false)
  event.node.res.emit('close')
  assert.equal(stream.destroyed, true, 'a client that disconnects mid-download must not leave the file descriptor open')
}))

test('no handler under server/api/admin/backup/ reads a whole file into memory', () => {
  const offenders: string[] = []
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir)); continue }
      if (!entry.name.endsWith('.ts')) continue
      const file = new URL(entry.name, dir)
      if (/\breadFile(Sync)?\b/.test(readFileSync(file, 'utf8'))) offenders.push(file.pathname)
    }
  }
  walk(new URL('../server/api/admin/backup/', import.meta.url))
  assert.deepEqual(offenders, [], `readFile in: ${offenders.join(', ')}`)
})

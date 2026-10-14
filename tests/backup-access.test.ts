import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

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

mock.module('../server/services/backup', {
  namedExports: {
    deleteBackup: record('deleteBackup'),
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
type FakeEvent = { context: { adminUser: unknown }, body?: unknown, params?: Record<string, string> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = h3.createError
globals.readBody = async (event: FakeEvent) => { calls.push('readBody'); return event.body }
globals.readMultipartFormData = async () => { calls.push('readMultipartFormData'); return [{ name: 'file', filename: 'x.sql.gz', data: Buffer.from([0x1f, 0x8b]) }] }
globals.getRouterParam = (event: FakeEvent, name: string) => event.params?.[name]
let contentLength: string | undefined
globals.getRequestHeader = (_event: unknown, name: string) => (name === 'content-length' ? contentLength : undefined)
globals.setHeader = () => { calls.push('setHeader') }

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

import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/media/storage-size` (server/api/admin/media/storage-size.get.ts)
 * — the three numbers on /admin/media: what the `media` table says each storage
 * holds, what is really on disk under `public/uploads/`, and what is in the R2
 * bucket.
 *
 * The invariants:
 *   - it takes `media.read`; without it nothing is read and R2 is not asked;
 *   - the database numbers are per provider (`local` / `r2`);
 *   - the disk walk counts every regular file under `<cwd>/public/uploads`, at any
 *     depth, orphans included — and nothing outside it: a symbolic link inside
 *     the tree (to a file or a directory elsewhere, or back to the tree itself) is
 *     not followed, so a link cannot make the walk read or count the rest of the
 *     server, or loop;
 *   - a directory it cannot read is skipped, not a 500; a missing tree is 0;
 *   - R2 is asked only when fully configured — account, access key, a secret that
 *     decrypts, bucket — every page of the listing is summed, and an R2 failure is
 *     `null` (the page shows "error", not "0 bytes"), with no detail sent back;
 *   - a database failure is a 500.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite;
 * real files and links under a temporary working directory; the real settings
 * envelope and R2 config checks. The S3 SDK is the only fake (the network edge).
 */

process.env.JWT_SECRET = 'media-storage-size-behavior-test-secret-0123456789'
process.env.CHATBOT_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString('base64')
const ROTATED_AWAY_SECRET = Buffer.alloc(32, 9).toString('base64')
delete process.env.MFA_ENFORCEMENT

const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'cdkt-storage-size-')))
const outside = join(workdir, 'outside')
const originalCwd = process.cwd()
process.chdir(workdir)
const uploadsRoot = join(workdir, 'public', 'uploads')

// ─── Fake S3 SDK (the only network edge) ──────────────────────────────────────
type Page = { Contents?: Array<{ Key: string, Size?: number }>, IsTruncated?: boolean, NextContinuationToken?: string }
const s3 = { endpoints: [] as string[], listed: [] as Array<Record<string, unknown>>, pages: [] as Page[], fail: null as Error | null }
class FakeS3Client {
  constructor(config: { endpoint: string }) { s3.endpoints.push(config.endpoint) }
  async send(command: { input: Record<string, unknown>, constructor: { name: string } }) {
    if (command.constructor.name !== 'ListObjectsV2Command') throw new Error(`unexpected ${command.constructor.name}`)
    s3.listed.push(command.input)
    if (s3.fail) throw s3.fail
    return s3.pages[s3.listed.length - 1] ?? { Contents: [], IsTruncated: false }
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

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, media } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, media])

const warned: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: (fields: Record<string, unknown>) => { warned.push(fields) },
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const storageSize = (await import('../server/api/admin/media/storage-size.get')).default
const { sealSettingsSecret } = await import('../server/utils/settings-secrets')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'get', path: '/api/admin/media/storage-size', handler: storageSize }], [adminAuth])
after(async () => {
  await server.close()
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})

type Account = { id: number, username: string, roleId: number, roleName: string }
const LIBRARIAN: Account = { id: 4, username: 'thuvien', roleId: 3, roleName: 'Xem thư viện' }
const EDITOR: Account = { id: 5, username: 'bientap', roleId: 4, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const measure = (account = LIBRARIAN) => server.request('GET', '/api/admin/media/storage-size', { cookie: cookieFor(account) })

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
async function configureR2(secretValue: string = sealSettingsSecret('r2_secret_key', 'r2-secret-value'), accountId = ACCOUNT_ID) {
  await harness.db.insert(settings).values([
    { key: 'r2_account_id', value: accountId },
    { key: 'r2_access_key', value: 'access-key-id' },
    { key: 'r2_secret_key', value: secretValue },
    { key: 'r2_bucket', value: 'cdkt-media' },
  ])
}
function writeBytes(path: string, size: number) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.alloc(size, 1))
}
let mediaId = 0
const addMedia = (provider: 'local' | 'r2', sizeBytes: number) => {
  mediaId += 1
  return harness.db.insert(media).values({ id: mediaId, filename: `f${mediaId}.jpg`, originalName: `f${mediaId}.jpg`, mimeType: 'image/jpeg', sizeBytes, provider, url: `/uploads/f${mediaId}.jpg`, storagePath: `f${mediaId}.jpg` })
}

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  s3.endpoints.length = 0
  s3.listed.length = 0
  warned.length = 0
  s3.pages = []
  s3.fail = null
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  await harness.db.insert(roles).values([LIBRARIAN, EDITOR].map(account => ({ id: account.roleId, name: account.roleName, isSystem: false })))
  await harness.db.insert(permissions).values([
    { roleId: LIBRARIAN.roleId, resource: 'media', canRead: true },
    { roleId: EDITOR.roleId, resource: 'news', canRead: true, canCreate: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([LIBRARIAN, EDITOR].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

test('without media.read nothing is read and R2 is not asked: no session → 401, other resources → 403', async () => {
  await configureR2()
  assert.equal((await server.request('GET', '/api/admin/media/storage-size')).status, 401)
  assert.equal((await measure(EDITOR)).status, 403)
  assert.deepEqual(s3.endpoints, [])
  assert.deepEqual(s3.listed, [])
})

test('the database numbers are per provider; nothing configured → disk 0, R2 "not configured" with null bucket numbers', async () => {
  await addMedia('local', 100)
  await addMedia('local', 250)
  await addMedia('r2', 4000)
  const response = await measure()
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    ok: true,
    local: { dbCount: 2, dbBytes: 350, diskCount: 0, diskBytes: 0 },
    r2: { configured: false, dbCount: 1, dbBytes: 4000, bucketCount: null, bucketBytes: null },
  })
  assert.deepEqual(s3.endpoints, [], 'no R2 client was even built')
})

test('the disk walk counts every regular file under public/uploads, at any depth, orphans included', async () => {
  writeBytes(join(uploadsRoot, '2026', '10', 'a.jpg'), 5)
  writeBytes(join(uploadsRoot, '2026', '10', 'nested', 'deep', 'b.png'), 7)
  writeBytes(join(uploadsRoot, 'orphan.bin'), 3)
  mkdirSync(join(uploadsRoot, 'empty-dir'))
  writeBytes(join(workdir, 'public', 'not-uploads.txt'), 1000) // beside the tree, not in it
  const { body } = await measure()
  assert.deepEqual(body.local, { dbCount: 0, dbBytes: 0, diskCount: 3, diskBytes: 15 })
})

test('a symbolic link inside the tree is not followed: not to a file or a directory outside, not back into the tree', async () => {
  writeBytes(join(uploadsRoot, '2026', 'real.jpg'), 11)
  writeBytes(join(outside, 'secrets', 'big.bin'), 50_000)
  writeBytes(join(outside, 'single.bin'), 20_000)
  symlinkSync(join(outside, 'secrets'), join(uploadsRoot, 'linked-dir'))
  symlinkSync(join(outside, 'single.bin'), join(uploadsRoot, 'linked-file.jpg'))
  symlinkSync(uploadsRoot, join(uploadsRoot, '2026', 'loop')) // would count real.jpg again, forever
  symlinkSync(join(uploadsRoot, '2026'), join(uploadsRoot, 'alias')) // same files under another name
  const { status, body } = await measure()
  assert.equal(status, 200)
  assert.deepEqual(body.local, { dbCount: 0, dbBytes: 0, diskCount: 1, diskBytes: 11 })
})

test('a directory that cannot be read is skipped, the rest is still counted; a missing tree is 0, not an error', async (t) => {
  writeBytes(join(uploadsRoot, 'ok.jpg'), 4)
  writeBytes(join(uploadsRoot, 'locked', 'hidden.jpg'), 9)
  chmodSync(join(uploadsRoot, 'locked'), 0o000)
  // So a failing assertion below never leaves a directory the next cleanup cannot delete.
  t.after(() => { if (existsSync(join(uploadsRoot, 'locked'))) chmodSync(join(uploadsRoot, 'locked'), 0o755) })
  const locked = await measure()
  assert.equal(locked.status, 200)
  // root reads through mode 000; everyone else (the app runs as `node`) cannot.
  const expected = process.getuid?.() === 0 ? { diskCount: 2, diskBytes: 13 } : { diskCount: 1, diskBytes: 4 }
  assert.deepEqual(locked.body.local, { dbCount: 0, dbBytes: 0, ...expected })

  chmodSync(join(uploadsRoot, 'locked'), 0o755)
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  const missing = await measure()
  assert.equal(missing.status, 200)
  assert.deepEqual(missing.body.local, { dbCount: 0, dbBytes: 0, diskCount: 0, diskBytes: 0 })
  assert.deepEqual(warned, [], 'a missing tree is not a failure (and a skipped sub-directory is not logged)')
})

test('FINDING-R8-5: the uploads root ITSELF unreadable is null on disk — not 0, which reads as an empty tree — and is logged', { skip: process.getuid?.() === 0 ? 'root reads through mode 000' : false }, async (t) => {
  // The incident this guards (test-coverage-baseline R4 "Ghi nhận"): `public/uploads` owned by
  // the wrong user. The walk swallowed the root's EACCES and answered `0 B, 0 tệp`; the page
  // showed that as the real size (and no orphans).
  writeBytes(join(uploadsRoot, '2026', 'a.jpg'), 7)
  await addMedia('local', 7)
  chmodSync(uploadsRoot, 0o000)
  t.after(() => { if (existsSync(uploadsRoot)) chmodSync(uploadsRoot, 0o755) })
  const response = await measure()
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.local, { dbCount: 1, dbBytes: 7, diskCount: null, diskBytes: null })
  assert.deepEqual(warned.map(w => [w.event, w.code]), [['media.storage_size_disk_unreadable', 'EACCES']])
  chmodSync(uploadsRoot, 0o755)
  assert.deepEqual((await measure()).body.local, { dbCount: 1, dbBytes: 7, diskCount: 1, diskBytes: 7 }, 'readable again: the real numbers')
})

test('R2 fully configured: every page of the listing is summed, against the configured account and bucket', async () => {
  await configureR2()
  s3.pages = [
    { Contents: [{ Key: 'a', Size: 100 }, { Key: 'b', Size: 200 }], IsTruncated: true, NextContinuationToken: 'page-2' },
    { Contents: [{ Key: 'c', Size: 300 }, { Key: 'd' }], IsTruncated: true, NextContinuationToken: 'page-3' },
    { Contents: [{ Key: 'e', Size: 5 }], IsTruncated: false },
  ]
  const { body } = await measure()
  assert.deepEqual(body.r2, { configured: true, dbCount: 0, dbBytes: 0, bucketCount: 5, bucketBytes: 605 })
  assert.deepEqual(s3.endpoints, [`https://${ACCOUNT_ID}.r2.cloudflarestorage.com`])
  assert.deepEqual(s3.listed.map(input => [input.Bucket, input.ContinuationToken]), [['cdkt-media', undefined], ['cdkt-media', 'page-2'], ['cdkt-media', 'page-3']])
})

test('R2 counts as not configured when a part is missing or the stored secret no longer decrypts — nothing is asked', async () => {
  await configureR2(sealSettingsSecret('r2_secret_key', 'r2-secret-value', ROTATED_AWAY_SECRET))
  const unreadable = await measure()
  assert.deepEqual(unreadable.body.r2, { configured: false, dbCount: 0, dbBytes: 0, bucketCount: null, bucketBytes: null })

  harness.sqlite.prepare("DELETE FROM settings WHERE key = 'r2_access_key'").run()
  harness.sqlite.prepare("UPDATE settings SET value = 'r2-plain-legacy' WHERE key = 'r2_secret_key'").run()
  const partial = await measure()
  assert.equal((partial.body.r2 as { configured: boolean }).configured, false)
  assert.deepEqual(s3.endpoints, [])
})

test('an R2 failure is null bucket numbers, not 0 and not an error page — with no detail sent back', async () => {
  await configureR2()
  s3.fail = Object.assign(new Error('InvalidAccessKeyId: The AWS Access Key Id access-key-id does not exist (RequestId: 7f3a)'), { name: 'InvalidAccessKeyId' })
  const failed = await measure()
  assert.equal(failed.status, 200)
  assert.deepEqual(failed.body.r2, { configured: true, dbCount: 0, dbBytes: 0, bucketCount: null, bucketBytes: null })
  assert.ok(!JSON.stringify(failed.body).includes('InvalidAccessKeyId'))

  // An account id that is not a Cloudflare account id is refused before any client exists.
  harness.sqlite.prepare("UPDATE settings SET value = 'evil.example.com/x' WHERE key = 'r2_account_id'").run()
  s3.fail = null
  s3.endpoints.length = 0
  const invalid = await measure()
  assert.equal(invalid.status, 200)
  assert.equal((invalid.body.r2 as { bucketBytes: unknown }).bucketBytes, null)
  assert.deepEqual(s3.endpoints, [])
})

test('a database failure is a 500', async () => {
  harness.failNext(/from `media`/)
  assert.equal((await measure()).status, 500)
})

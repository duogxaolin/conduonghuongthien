import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import test, { after, beforeEach, mock } from 'node:test'
import sharp from 'sharp'

/**
 * `POST /api/admin/media/upload` (server/api/admin/media/upload.post.ts) — the
 * Media Library's only way for a file to reach the public uploads folder or the
 * R2 bucket, and from there every page of the portal.
 *
 * The invariants:
 *   - it takes `media.create`; a caller without it writes nothing;
 *   - an upload declared as an image is judged by its MAGIC BYTES: SVG (a document
 *     that runs script on the portal's origin) and HTML dressed as `image/png` are
 *     refused before anything is written;
 *   - the stored extension and MIME come from the validated type, never from the
 *     client's filename — `x.svg` sent as PDF is stored `.pdf`, `clip.html` sent as
 *     video is stored `.mp4`; a hostile name cannot leave the month folder;
 *   - PNG/JPEG become WebP, an image wider than 2400 px is scaled down, but GIF
 *     (animation) and WebP (no second encode) are kept byte for byte — keyed off
 *     the magic-byte verdict, so a GIF declared as PNG is still not flattened;
 *   - 20 MB is the hard cap;
 *   - with R2 selected, an incomplete R2 configuration sends nothing; a complete
 *     one gets exactly one `PutObject` of the processed bytes;
 *   - the `media` row and its audit line commit together — and when they do not,
 *     the file already written (disk or R2) is removed: no orphan nobody can list;
 *   - each upload gets its own file: `Date.now()_name` alone collided within one
 *     millisecond (two rows, one file — deleting either lost both); a random
 *     suffix separates them, and the local write is exclusive (`wx`).
 *
 * Real h3 app with the real `admin-auth` middleware, a real multipart body built
 * by `fetch`, real sharp, real `uploadLocalFile` writing under a temporary
 * working directory; Drizzle's SQL on SQLite (`_sqlite-mysql-db.ts`, real
 * transaction); the S3 SDK is the only fake (the network edge).
 */

process.env.JWT_SECRET = 'media-upload-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'cdkt-media-upload-')))
const originalCwd = process.cwd()
process.chdir(workdir)
const uploadsRoot = join(workdir, 'public', 'uploads')

// ─── Fake S3 SDK (the only network edge) ──────────────────────────────────────
type Sent = { name: string, input: Record<string, unknown> }
const s3 = { sent: [] as Sent[], endpoints: [] as string[], failDelete: false }
class FakeS3Client {
  constructor(config: { endpoint: string }) { s3.endpoints.push(config.endpoint) }
  async send(command: { input: Record<string, unknown>, constructor: { name: string } }) {
    s3.sent.push({ name: command.constructor.name, input: command.input })
    if (s3.failDelete && command.constructor.name === 'DeleteObjectCommand') throw new Error('R2 DeleteObject: 503 Service Unavailable')
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

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, media } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, media])

/** Every `logWarn` entry, in order. */
const warnings: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: (entry: Record<string, unknown>) => { warnings.push(entry) },
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const uploadHandler = (await import('../server/api/admin/media/upload.post')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'post', path: '/api/admin/media/upload', handler: uploadHandler }], [adminAuth])
after(async () => {
  await server.close()
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})

type Account = { id: number, username: string, roleId: number, roleName: string }
const UPLOADER: Account = { id: 4, username: 'uploader', roleId: 3, roleName: 'Biên tập ảnh' }
const VIEWER: Account = { id: 5, username: 'viewer', roleId: 4, roleName: 'Xem thư viện' }

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

type Part = { bytes: Buffer, type: string, name: string }
function upload(part: Part, account = UPLOADER) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(part.bytes)], { type: part.type }), part.name)
  return server.request('POST', '/api/admin/media/upload', { cookie: cookieFor(account), body: form })
}

/** Every file under the working directory, relative and with forward slashes. */
function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(workdir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}
const snapshot = () => ({
  files: filesUnder(workdir),
  media: harness.rows(media).length,
  audit: harness.rows(activityLogs).length,
  s3: s3.sent.length,
})

/**
 * `public/uploads/YYYY/MM` of a stored row. Read back from the row's URL (the
 * server's clock at upload time) rather than recomputed here, so a run that
 * crosses a month boundary cannot flake; the shape is still pinned.
 */
function monthDirOf(row: Record<string, unknown>): string {
  const match = /^\/uploads\/(\d{4})\/(\d{2})\/([^/]+)$/.exec(String(row.url))
  assert.ok(match, `url ${String(row.url)} is /uploads/YYYY/MM/<file>`)
  assert.equal(match[3], row.filename)
  return `public/uploads/${match[1]}/${match[2]}`
}

// ─── Fixtures: real image bytes from sharp ────────────────────────────────────
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 74, g: 103, b: 65, alpha: 1 } } })
const PNG = await solid(40, 30).png().toBuffer()
const JPEG = await solid(40, 30).jpeg().toBuffer()
const GIF = await solid(16, 16).gif().toBuffer()
const WEBP = await solid(24, 12).webp().toBuffer()
const WIDE_PNG = await solid(3000, 20).png().toBuffer()
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>')
const HTML = Buffer.from('<!doctype html><script>alert(document.domain)</script>')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(16)])

const isWebp = (bytes: Buffer) => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'

beforeEach(async () => {
  harness.reset()
  s3.sent.length = 0
  s3.endpoints.length = 0
  s3.failDelete = false
  warnings.length = 0
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  await harness.db.insert(roles).values([
    { id: UPLOADER.roleId, name: UPLOADER.roleName, isSystem: false },
    { id: VIEWER.roleId, name: VIEWER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: UPLOADER.roleId, resource: 'media', canCreate: true, canRead: true },
    { roleId: VIEWER.roleId, resource: 'media', canRead: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([UPLOADER, VIEWER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

test('without media.create nothing is written: no session → 401, read/update/delete only → 403', async () => {
  const before = snapshot()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'logo.png')
  assert.equal((await server.request('POST', '/api/admin/media/upload', { body: form })).status, 401)
  assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' }, VIEWER)).status, 403)
  assert.deepEqual(snapshot(), before)
})

test('a PNG is stored as WebP in the month folder, with its row and an audit line naming the uploader', async () => {
  const response = await upload({ bytes: PNG, type: 'image/png', name: 'Logo Cục C11.png' })
  assert.equal(response.status, 200)

  const [row] = harness.rows(media)
  assert.ok(row)
  assert.equal(row.mimeType, 'image/webp')
  assert.equal(row.provider, 'local')
  assert.equal(row.originalName, 'Logo Cục C11.png')
  // `<ms>_<8 hex>_<name>`: the random part keeps two uploads of one name in one millisecond apart.
  assert.match(String(row.filename), /^\d+_[0-9a-f]{8}_Logo_C_c_C11\.webp$/)
  const monthDir = monthDirOf(row)
  assert.equal(row.storagePath, join(workdir, monthDir, String(row.filename)))
  assert.equal(row.width, 40)
  assert.equal(row.height, 30)
  assert.equal(row.uploadedBy, UPLOADER.id)

  assert.deepEqual(filesUnder(workdir), [`${monthDir}/${row.filename}`])
  const stored = readFileSync(String(row.storagePath))
  assert.ok(isWebp(stored), 'the bytes on disk are WebP, matching the extension and the stored MIME')
  assert.equal(row.sizeBytes, stored.length)

  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, UPLOADER.id)
  assert.equal(audit[0]!.action, 'create')
  assert.equal(audit[0]!.resource, 'media')
  assert.equal(audit[0]!.resourceId, row.id)
  assert.deepEqual(audit[0]!.meta, { originalName: 'Logo Cục C11.png', url: row.url, provider: 'local' })

  const body = response.body.media as Record<string, unknown>
  assert.equal(body.id, row.id)
  assert.equal(body.mimeType, 'image/webp')
  assert.equal(body.url, row.url)
})

test('a JPEG is converted to WebP too', async () => {
  assert.equal((await upload({ bytes: JPEG, type: 'image/jpeg', name: 'anh.jpg' })).status, 200)
  const [row] = harness.rows(media)
  assert.equal(row!.mimeType, 'image/webp')
  assert.match(String(row!.filename), /\.webp$/)
  assert.ok(isWebp(readFileSync(String(row!.storagePath))))
})

test('the bytes decide the type: a GIF declared as image/png is stored as .gif, byte for byte (never flattened)', async () => {
  assert.equal((await upload({ bytes: GIF, type: 'image/png', name: 'dong.png' })).status, 200)
  const [row] = harness.rows(media)
  assert.equal(row!.mimeType, 'image/gif')
  assert.match(String(row!.filename), /^\d+_[0-9a-f]{8}_dong\.gif$/)
  assert.deepEqual(readFileSync(String(row!.storagePath)), GIF)
})

test('a WebP is kept as uploaded — no second lossy encode', async () => {
  assert.equal((await upload({ bytes: WEBP, type: 'image/webp', name: 'san.webp' })).status, 200)
  const [row] = harness.rows(media)
  assert.equal(row!.mimeType, 'image/webp')
  assert.deepEqual(readFileSync(String(row!.storagePath)), WEBP)
})

test('an image wider than 2400 px is scaled down to 2400 px, keeping its aspect', async () => {
  assert.equal((await upload({ bytes: WIDE_PNG, type: 'image/png', name: 'bang-ron.png' })).status, 200)
  const [row] = harness.rows(media)
  assert.equal(row!.width, 2400)
  assert.equal(row!.height, 16)
  const meta = await sharp(readFileSync(String(row!.storagePath))).metadata()
  assert.equal(meta.width, 2400)
  assert.equal(meta.format, 'webp')
})

test('declared image, not an image by its bytes → 415, nothing on disk, no row: SVG and HTML-as-PNG', async () => {
  const before = snapshot()
  assert.equal((await upload({ bytes: SVG, type: 'image/svg+xml', name: 'logo.svg' })).status, 415)
  assert.equal((await upload({ bytes: HTML, type: 'image/png', name: 'logo.png' })).status, 415)
  assert.deepEqual(snapshot(), before)
})

test('a type outside image / video / PDF is refused 400 before anything is written', async () => {
  const before = snapshot()
  assert.equal((await upload({ bytes: HTML, type: 'text/html', name: 'page.html' })).status, 400)
  assert.equal((await upload({ bytes: SVG, type: 'application/octet-stream', name: 'logo.svg' })).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('the extension never comes from the client filename: x.svg as PDF → .pdf, clip.html as video → .mp4', async () => {
  assert.equal((await upload({ bytes: PDF, type: 'application/pdf', name: 'x.svg' })).status, 200)
  assert.equal((await upload({ bytes: MP4, type: 'video/mp4', name: 'clip.html' })).status, 200)
  assert.equal((await upload({ bytes: MP4, type: 'video/webm', name: 'clip.webm' })).status, 200)
  const rows = harness.rows(media).sort((a, b) => Number(a.id) - Number(b.id))
  assert.deepEqual(rows.map(row => [row.mimeType, String(row.filename).replace(/^\d+_[0-9a-f]{8}_/, '')]), [
    ['application/pdf', 'x.pdf'],
    ['video/mp4', 'clip.mp4'],
    ['video/webm', 'clip.webm'],
  ])
  for (const name of filesUnder(workdir)) assert.doesNotMatch(name, /\.(svg|html)$/)
})

test('a hostile filename stays a filename: written inside the month folder, nothing outside it', async () => {
  const response = await upload({ bytes: PNG, type: 'image/png', name: '../../../../.env.png' })
  assert.equal(response.status, 200)
  const [row] = harness.rows(media)
  assert.match(String(row!.filename), /^\d+_[0-9a-f]{8}_[A-Za-z0-9_-]+\.webp$/)
  const monthDir = monthDirOf(row!)
  assert.deepEqual(filesUnder(workdir), [`${monthDir}/${row!.filename}`])
  assert.ok(String(row!.storagePath).startsWith(join(workdir, monthDir) + sep))
})

test('over 20 MB is refused 413 — and an empty form 400 — with nothing written', async () => {
  const before = snapshot()
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1)
  PNG.copy(oversized)
  assert.equal((await upload({ bytes: oversized, type: 'image/png', name: 'qua-lon.png' })).status, 413)
  const empty = await server.request('POST', '/api/admin/media/upload', { cookie: cookieFor(UPLOADER), body: new FormData() })
  assert.equal(empty.status, 400)
  assert.deepEqual(snapshot(), before)
})

test('R2 selected but its configuration incomplete → 400, nothing sent to R2, no row', async () => {
  await harness.db.insert(settings).values([
    { key: 'media_provider', value: 'r2' },
    { key: 'r2_account_id', value: '0123456789abcdef0123456789abcdef' },
    { key: 'r2_access_key', value: 'AKIDEXAMPLE' },
    { key: 'r2_bucket', value: 'cdkt-media' },
  ])
  const before = snapshot()
  assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('R2 selected and configured: one PutObject of the processed bytes, row points at the public URL, nothing on local disk', async () => {
  await harness.db.insert(settings).values([
    { key: 'media_provider', value: 'r2' },
    { key: 'r2_account_id', value: '0123456789abcdef0123456789abcdef' },
    { key: 'r2_access_key', value: 'AKIDEXAMPLE' },
    { key: 'r2_secret_key', value: 'legacy-plaintext-secret' },
    { key: 'r2_bucket', value: 'cdkt-media' },
    { key: 'r2_public_url', value: 'cdn.example.vn/' },
  ])
  assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })).status, 200)

  assert.equal(s3.sent.length, 1)
  const [put] = s3.sent
  assert.equal(put!.name, 'PutObjectCommand')
  assert.equal(put!.input.Bucket, 'cdkt-media')
  assert.equal(put!.input.ContentType, 'image/webp')
  assert.ok(isWebp(Buffer.from(put!.input.Body as Uint8Array)))
  assert.deepEqual(s3.endpoints, ['https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'])

  const [row] = harness.rows(media)
  const key = String(put!.input.Key)
  assert.match(key, new RegExp(`^\\d{4}/\\d{2}/${String(row!.filename).replace(/\./g, '\\.')}$`))
  assert.equal(row!.provider, 'r2')
  assert.equal(row!.storagePath, key)
  assert.equal(row!.url, `https://cdn.example.vn/${key}`)
  assert.deepEqual(filesUnder(workdir), [])
})

test('the row and its audit line commit together: audit insert fails → 500 and no media row', async () => {
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })).status, 500)
  assert.equal(harness.rows(media).length, 0)
  assert.equal(harness.rows(activityLogs).length, 0)
  assert.deepEqual(filesUnder(workdir), [], 'the file written before the failed transaction is an orphan no row points at')
})

/**
 * The file is written BEFORE the row (the row stores its URL), so a failed transaction left a
 * file in the public folder or the bucket that no `media` row lists: invisible in the library,
 * never deleted, served forever. It is removed on the way out; the caller still gets the
 * original failure.
 */
test('the media row cannot be written → 500, and the local file just written is removed', async () => {
  harness.failNext(/^insert into `media`/)
  assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })).status, 500)
  assert.equal(harness.rows(media).length, 0)
  assert.deepEqual(filesUnder(workdir), [])
  assert.deepEqual(warnings, [], 'a cleanup that worked is not a warning')
})

const R2_SETTINGS = [
  { key: 'media_provider', value: 'r2' },
  { key: 'r2_account_id', value: '0123456789abcdef0123456789abcdef' },
  { key: 'r2_access_key', value: 'AKIDEXAMPLE' },
  { key: 'r2_secret_key', value: 'legacy-plaintext-secret' },
  { key: 'r2_bucket', value: 'cdkt-media' },
  { key: 'r2_public_url', value: 'cdn.example.vn/' },
]

test('R2: the row cannot be written → 500, and the object just put is deleted (same bucket, same key)', async () => {
  await harness.db.insert(settings).values(R2_SETTINGS)
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })).status, 500)
  assert.deepEqual(s3.sent.map(sent => sent.name), ['PutObjectCommand', 'DeleteObjectCommand'])
  const [put, del] = s3.sent
  assert.equal(del!.input.Bucket, put!.input.Bucket)
  assert.equal(del!.input.Key, put!.input.Key)
  assert.equal(harness.rows(media).length, 0)
})

test('R2: a cleanup that fails is logged with the orphan\'s key, never replaces the original failure', async () => {
  await harness.db.insert(settings).values(R2_SETTINGS)
  s3.failDelete = true
  harness.failNext(/^insert into `media`/)
  const response = await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })
  assert.equal(response.status, 500)
  const [put] = s3.sent
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0]!.event, 'media.upload_orphan_cleanup_failed')
  assert.equal(warnings[0]!.storagePath, put!.input.Key)
  assert.equal(warnings[0]!.provider, 'r2')
})

test('two uploads of one name in the SAME millisecond get two files — neither overwrites the other', async () => {
  const now = mock.method(Date, 'now', () => 1_793_000_000_000)
  try {
    assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })).status, 200)
    assert.equal((await upload({ bytes: JPEG, type: 'image/jpeg', name: 'logo.jpg' })).status, 200)
  } finally {
    now.mock.restore()
  }
  const rows = harness.rows(media)
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0]!.filename, rows[1]!.filename, 'two rows, one filename')
  assert.notEqual(rows[0]!.storagePath, rows[1]!.storagePath, 'two rows share one file: deleting either loses both')
  assert.equal(filesUnder(workdir).length, 2)
  for (const row of rows) assert.equal(readFileSync(String(row.storagePath)).length, row.sizeBytes, `${String(row.filename)} holds its own bytes`)
})

test('the local file is written exclusively (`wx`): an existing file is never overwritten', async () => {
  const fsPromises = (await import('node:fs')).promises
  const writes = mock.method(fsPromises, 'writeFile')
  try {
    assert.equal((await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })).status, 200)
  } finally {
    writes.mock.restore()
  }
  const [row] = harness.rows(media)
  const write = writes.mock.calls.find(call => call.arguments[0] === row!.storagePath)
  assert.ok(write, 'the upload went through fs.promises.writeFile')
  const options = write.arguments[2] as { flag?: string } | string | undefined
  assert.equal(typeof options === 'string' ? options : options?.flag, 'wx')
})

test('an uploads folder the server cannot write → 500 that names the permission problem, no row', { skip: process.getuid?.() === 0 ? 'root ignores directory permissions' : false }, async () => {
  mkdirSync(uploadsRoot, { recursive: true })
  chmodSync(uploadsRoot, 0o555)
  try {
    const response = await upload({ bytes: PNG, type: 'image/png', name: 'logo.png' })
    assert.equal(response.status, 500)
    assert.match(String(response.body.statusMessage ?? response.body.message), /quyền thư mục/)
    assert.equal(harness.rows(media).length, 0)
    assert.equal(statSync(uploadsRoot).isDirectory(), true)
  } finally {
    chmodSync(uploadsRoot, 0o755)
  }
})

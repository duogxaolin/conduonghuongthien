import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The Drive upload of a backup (server/services/backup-drive.ts), run under the real
 * off-site step (`backup-offsite.ts` `uploadRunOffsite`), the real Drive link and
 * Drive client services (`backup-drive-oauth*.ts`) and real files on disk. Only the
 * two Google client packages are replaced — the module under test builds every
 * request they receive. Invariants:
 *   - a Drive failure — the API throwing, or answering without a file id — marks the
 *     file `failed` and leaves the local file exactly as it was; files uploaded
 *     before the failure stay `uploaded`;
 *   - what reaches Drive is the local file's own bytes, under its own name, inside
 *     `cdht_backup/<database|file>/<UTC day of the stamp>` (never the server's local
 *     day), under the folder the settings name when they name one;
 *   - folders are found before they are created: a second run on the same day, or a
 *     second file in the same run, creates no duplicate folder;
 *   - the service account asks for exactly the `drive.file` scope; the OAuth mode
 *     signs in with the decrypted Drive client and only the refresh token, and is
 *     preferred over the service account when both are configured.
 *
 * Drizzle's SQL runs on SQLite (`_sqlite-mysql-db.ts`); the envelopes are the real
 * AES-GCM codec under a random key.
 */

// The day folder must be the stamp's UTC day even where local time is a day ahead.
process.env.TZ = 'Asia/Ho_Chi_Minh'
process.env.CHATBOT_ENCRYPTION_SECRET = randomBytes(32).toString('base64')

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { users, activityLogs, backups, backupDriveOauth, backupDriveOauthConfig } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([users, activityLogs, backups, backupDriveOauth, backupDriveOauthConfig])

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

// ─── Google, as far as the module under test can see it ─────────────────────
type DriveItem = { id: string, name: string, parents: string[], folder: boolean, bytes?: Buffer }
const drive = {
  items: [] as DriveItem[],
  lists: [] as string[],
  /** Every client the module built, and the auth object it handed over. */
  clients: [] as unknown[],
  /** A file (not folder) create whose name matches throws. */
  failFileCreate: null as null | RegExp,
  /** A file (not folder) create answers without an id. */
  omitFileId: false,
  nextId: 1,
}
const googleAuths: Array<{ credentials: unknown, scopes: unknown }> = []
const oauthClients: Array<{ clientId: string, clientSecret: string, credentials: unknown[] }> = []

/** Evaluates the `q` the module writes: `name='…' and … and '<parent>' in parents`. */
function listMatches(q: string): DriveItem[] {
  const name = /name='((?:\\'|[^'])*)'/.exec(q)?.[1]?.replace(/\\'/g, '\'')
  const parent = /'([^']+)' in parents/.exec(q)?.[1]
  assert.ok(name !== undefined && parent !== undefined, `unexpected Drive query: ${q}`)
  assert.match(q, /mimeType='application\/vnd\.google-apps\.folder'/)
  assert.match(q, /trashed=false/)
  return drive.items.filter(item => item.folder && item.name === name && item.parents.includes(parent))
}

mock.module('@googleapis/drive', {
  namedExports: {
    drive: (options: { version: string, auth: unknown }) => {
      assert.equal(options.version, 'v3')
      drive.clients.push(options.auth)
      return {
        files: {
          list: async (input: { q: string }) => {
            drive.lists.push(input.q)
            return { data: { files: listMatches(input.q).map(item => ({ id: item.id, name: item.name })) } }
          },
          create: async (input: { requestBody: { name: string, mimeType?: string, parents?: string[] }, media?: { body: AsyncIterable<Buffer> } }) => {
            const folder = input.requestBody.mimeType === 'application/vnd.google-apps.folder'
            const item: DriveItem = { id: `${folder ? 'folder' : 'file'}-${drive.nextId++}`, name: input.requestBody.name, parents: input.requestBody.parents ?? ['root'], folder }
            if (!folder) {
              const chunks: Buffer[] = []
              for await (const chunk of input.media!.body) chunks.push(Buffer.from(chunk))
              item.bytes = Buffer.concat(chunks)
              if (drive.failFileCreate?.test(item.name)) throw new Error('The user\'s Drive storage quota has been exceeded.')
              if (drive.omitFileId) return { data: {} }
            }
            drive.items.push(item)
            return { data: { id: item.id } }
          },
        },
      }
    },
  },
})
mock.module('google-auth-library', {
  namedExports: {
    GoogleAuth: class {
      constructor(options: { credentials: unknown, scopes: unknown }) { googleAuths.push({ credentials: options.credentials, scopes: options.scopes }) }
    },
    OAuth2Client: class {
      record: { clientId: string, clientSecret: string, credentials: unknown[] }
      constructor(clientId: string, clientSecret: string) {
        this.record = { clientId, clientSecret, credentials: [] }
        oauthClients.push(this.record)
      }
      setCredentials(credentials: unknown) { this.record.credentials.push(credentials) }
    },
  },
})

const { uploadRunOffsite } = await import('../server/services/backup-offsite')
const { storeDriveLink } = await import('../server/services/backup-drive-oauth')
const { updateDriveOauthConfig } = await import('../server/services/backup-drive-oauth-config')

// ─── Fixtures ────────────────────────────────────────────────────────────────
const STAMP = '20260921T180000Z' // 01:00 on 22 September in Hà Nội; 21 September in UTC
const SQL_FILE = `cdkt-${STAMP}-scheduled.sql.gz`
const MEDIA_FILE = `cdkt-uploads-${STAMP}-scheduled.tar.gz`
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'backup@project.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n' })
const REFRESH_TOKEN = '1//0g-refresh-token-for-the-backup-account-AbC123'
const CLIENT_ID = '210987654321-drivebackupclient.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-drive-backup-secret-K4w2'

const dir = mkdtempSync(path.join(tmpdir(), 'cdkt-drive-upload-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const contents = new Map<string, Buffer>()
const files = [{ name: SQL_FILE, type: 'sql' as const }, { name: MEDIA_FILE, type: 'media' as const }]
const serviceAccountOnly = { driveEnabled: true, driveServiceAccount: SERVICE_ACCOUNT, driveFolderId: '' }

const statusOf = () => Object.fromEntries(harness.rows(backups).map(row => [row.filename, { offsite: row.offsiteStatus, uploaded: row.driveUploaded, fileId: row.driveFileId }]))
const folders = () => drive.items.filter(item => item.folder)
const uploadedFile = (name: string) => drive.items.find(item => !item.folder && item.name === name)
const folderPath = (item: DriveItem): string => {
  const parent = drive.items.find(candidate => candidate.id === item.parents[0])
  return parent ? `${folderPath(parent)}/${item.name}` : `${item.parents[0]}:/${item.name}`
}

beforeEach(async () => {
  harness.reset()
  warnings.length = 0
  Object.assign(drive, { items: [], lists: [], clients: [], failFileCreate: null, omitFileId: false, nextId: 1 })
  googleAuths.length = 0
  oauthClients.length = 0
  for (const file of files) {
    const bytes = randomBytes(64 * 1024 + 17)
    contents.set(file.name, bytes)
    writeFileSync(path.join(dir, file.name), bytes)
  }
  await harness.db.insert(users).values({ id: 1, username: 'admin', email: 'admin@example.vn', passwordHash: 'x' })
  await harness.db.insert(backups).values(files.map(file => ({
    filename: file.name, type: file.type, bytes: contents.get(file.name)!.length, stamp: STAMP, trigger: 'scheduled', status: 'done',
  })))
})

test('a Drive failure marks the file failed and leaves the local copy exactly as it was', async () => {
  drive.failFileCreate = /\.sql\.gz$/
  const result = await uploadRunOffsite(harness.db as never, dir, STAMP, files, serviceAccountOnly)

  assert.equal(result.driveUploaded, false)
  assert.match(result.driveError ?? '', /quota/)
  assert.deepEqual(statusOf(), {
    [SQL_FILE]: { offsite: 'failed', uploaded: false, fileId: null },
    [MEDIA_FILE]: { offsite: 'failed', uploaded: false, fileId: null },
  })
  for (const file of files) {
    assert.ok(existsSync(path.join(dir, file.name)), `${file.name} was deleted`)
    assert.deepEqual(readFileSync(path.join(dir, file.name)), contents.get(file.name))
  }
  assert.ok(warnings.some(entry => entry.event === 'backup.drive_failed'))
})

test('a failure half-way keeps the earlier file uploaded and marks the rest failed', async () => {
  drive.failFileCreate = /\.tar\.gz$/
  await uploadRunOffsite(harness.db as never, dir, STAMP, files, serviceAccountOnly)
  const status = statusOf()
  assert.equal(status[SQL_FILE]!.offsite, 'uploaded')
  assert.equal(status[SQL_FILE]!.fileId, uploadedFile(SQL_FILE)!.id)
  assert.deepEqual(status[MEDIA_FILE], { offsite: 'failed', uploaded: false, fileId: null })
  assert.deepEqual(readFileSync(path.join(dir, MEDIA_FILE)), contents.get(MEDIA_FILE))
})

test('Drive answering without a file id is a failure, not an upload', async () => {
  drive.omitFileId = true
  const result = await uploadRunOffsite(harness.db as never, dir, STAMP, files, serviceAccountOnly)
  assert.equal(result.driveUploaded, false)
  assert.deepEqual(statusOf()[SQL_FILE], { offsite: 'failed', uploaded: false, fileId: null })
  assert.ok(existsSync(path.join(dir, SQL_FILE)))
})

test('Drive receives the local file\'s own bytes, under its name, in cdht_backup/<kind>/<UTC day>', async () => {
  const result = await uploadRunOffsite(harness.db as never, dir, STAMP, files, serviceAccountOnly)
  assert.equal(result.driveUploaded, true)

  for (const file of files) {
    const uploaded = uploadedFile(file.name)
    assert.ok(uploaded, `${file.name} never reached Drive`)
    assert.deepEqual(uploaded.bytes, contents.get(file.name), `${file.name}: the bytes on Drive differ from the local file`)
    assert.equal(statusOf()[file.name]!.offsite, 'uploaded')
    assert.equal(statusOf()[file.name]!.fileId, uploaded.id)
    assert.equal(statusOf()[file.name]!.uploaded, true)
  }
  assert.equal(folderPath(uploadedFile(SQL_FILE)!), 'root:/cdht_backup/database/2026-09-21/' + SQL_FILE)
  assert.equal(folderPath(uploadedFile(MEDIA_FILE)!), 'root:/cdht_backup/file/2026-09-21/' + MEDIA_FILE)
})

test('folders are found before they are created: one tree per day, however many files and runs', async () => {
  await uploadRunOffsite(harness.db as never, dir, STAMP, files, serviceAccountOnly)
  // cdht_backup once for both files, then database, file and one day folder under each.
  assert.deepEqual(folders().map(folderPath).sort(), [
    'root:/cdht_backup',
    'root:/cdht_backup/database',
    'root:/cdht_backup/database/2026-09-21',
    'root:/cdht_backup/file',
    'root:/cdht_backup/file/2026-09-21',
  ])

  await uploadRunOffsite(harness.db as never, dir, STAMP, files, serviceAccountOnly)
  assert.equal(folders().length, 5, 'a second run on the same day created folders again')
  assert.equal(drive.items.filter(item => !item.folder).length, 4)
})

test('the folder named in the settings is the parent of cdht_backup', async () => {
  await uploadRunOffsite(harness.db as never, dir, STAMP, files.slice(0, 1), { ...serviceAccountOnly, driveFolderId: 'officer-chosen-folder' })
  assert.equal(folderPath(uploadedFile(SQL_FILE)!), `officer-chosen-folder:/cdht_backup/database/2026-09-21/${SQL_FILE}`)
  assert.ok(drive.lists[0]!.includes('\'officer-chosen-folder\' in parents'))
})

test('the service account signs in with its own key and asks for drive.file only', async () => {
  await uploadRunOffsite(harness.db as never, dir, STAMP, files.slice(0, 1), serviceAccountOnly)
  assert.equal(googleAuths.length, 1)
  assert.deepEqual(googleAuths[0]!.credentials, JSON.parse(SERVICE_ACCOUNT))
  assert.deepEqual(googleAuths[0]!.scopes, ['https://www.googleapis.com/auth/drive.file'])
  assert.equal(oauthClients.length, 0)
})

test('a linked account is preferred, signing in with the decrypted Drive client and only the refresh token', async () => {
  await updateDriveOauthConfig(1, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, isEnabled: true })
  await storeDriveLink(1, { refreshToken: REFRESH_TOKEN, linkedEmail: 'backup-owner@example.vn', linkedSub: '1100' })

  const result = await uploadRunOffsite(harness.db as never, dir, STAMP, files, serviceAccountOnly)
  assert.equal(result.driveUploaded, true)
  assert.equal(googleAuths.length, 0, 'the service account was used although an account is linked')
  assert.equal(oauthClients.length, 2) // one client per file
  for (const client of oauthClients) {
    assert.equal(client.clientId, CLIENT_ID)
    assert.equal(client.clientSecret, CLIENT_SECRET)
    assert.deepEqual(client.credentials, [{ refresh_token: REFRESH_TOKEN }])
  }
  assert.equal(statusOf()[SQL_FILE]!.offsite, 'uploaded')
})

test('a service-account key that is not JSON fails the files and keeps them', async () => {
  await uploadRunOffsite(harness.db as never, dir, STAMP, files, { ...serviceAccountOnly, driveServiceAccount: '{not json' })
  assert.deepEqual(Object.values(statusOf()).map(status => status.offsite), ['failed', 'failed'])
  assert.equal(drive.items.length, 0)
  for (const file of files) assert.deepEqual(readFileSync(path.join(dir, file.name)), contents.get(file.name))
})

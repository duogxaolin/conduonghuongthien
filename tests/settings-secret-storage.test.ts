import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test, { beforeEach, mock } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Bí mật trong `settings` được mã hoá khi lưu (spec settings-secret-storage,
 * design D-SECRETS): `smtp_pass`, `r2_secret_key`, `backup_drive_service_account`.
 *
 * Trước đây ba giá trị này nằm nguyên văn trong bảng — và do đó nguyên văn trong
 * MỌI bản dump CSDL (sao lưu trong app, dump trước deploy, bản đẩy lên Drive).
 *
 * Chạy THẬT: các handler lưu/đọc cài đặt, "gửi email thử", "kiểm tra R2", hàm đọc
 * để dùng (`getSmtpConfig`, `loadR2Config`, `readBackupConfig`), và lượt chuyển
 * lúc khởi động — trên một bảng `settings` giả trong bộ nhớ, nodemailer giả và
 * client R2 giả ghi lại thông tin đăng nhập mà chúng nhận.
 */

const KEY = randomBytes(32).toString('base64')
const ROTATED = randomBytes(32).toString('base64')
process.env.CHATBOT_ENCRYPTION_SECRET = KEY

const SMTP_PASSWORD = 'Smtp-mat-khau-dai-Zq9!'
const R2_SECRET = 'r2-secret-access-key-0123456789-Wx7#'
const SA_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'backup@proj.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n',
})

let store = new Map<string, string | null>()
const transports: Array<{ host: string, auth?: { user: string, pass: string } }> = []
const r2Clients: Array<{ secretAccessKey: string }> = []

mock.module('nodemailer', {
  defaultExport: {
    createTransport: (options: typeof transports[number]) => {
      transports.push(options)
      return { sendMail: async () => {}, close: () => {} }
    },
  },
})
mock.module('../server/utils/media-r2', {
  namedExports: {
    createR2Client: (config: { secretAccessKey: string }) => {
      r2Clients.push({ secretAccessKey: config.secretAccessKey })
      return { send: async () => ({}), destroy: () => {} }
    },
    getR2BucketSize: async () => ({ count: 0, totalBytes: 0 }),
    uploadR2File: async () => ({ url: '', storagePath: '' }),
    deleteR2File: async () => {},
  },
})
const tx = {
  insert: () => ({
    values: (value: Record<string, unknown>) => {
      if ('action' in value) return Promise.resolve()
      return { onDuplicateKeyUpdate: async () => { store.set(String(value.key), value.value === null ? null : String(value.value)) } }
    },
  }),
  delete: () => ({ where: async () => {} }),
}
const fakeDb = {
  select: () => ({
    from: () => {
      const rows = async () => [...store].map(([key, value]) => ({ key, value }))
      return Object.assign(rows(), { where: () => rows() })
    },
  }),
  transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => ({}) } })
mock.module('../server/utils/permissions', {
  namedExports: {
    requireResourcePermission: () => {},
    requireSuperAdmin: (user: { isSuperAdmin?: boolean }) => {
      if (user?.isSuperAdmin !== true) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    },
  },
})

type Event = { body?: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const secrets = await import('../server/utils/settings-secrets')
const { convertPlaintextSettingsSecrets } = await import('../server/db/settings-secret-conversion')
type Handler = (event: Event) => Promise<Record<string, unknown>>
const settingsPut = (await import('../server/api/admin/settings/index.put')).default as unknown as Handler
const settingsGet = (await import('../server/api/admin/settings/index.get')).default as unknown as Handler
const backupPut = (await import('../server/api/admin/settings/backup.put')).default as unknown as Handler
const backupGet = (await import('../server/api/admin/settings/backup.get')).default as unknown as Handler
const testEmail = (await import('../server/api/admin/settings/test-email.post')).default as unknown as Handler
const testR2 = (await import('../server/api/admin/settings/test-r2.post')).default as unknown as Handler
const { getSmtpConfig, sendMail } = await import('../server/utils/mailer')
const { loadR2Config } = await import('../server/services/media')
const { readBackupConfig } = await import('../server/services/backup')

const SUPER = { id: 1, isSuperAdmin: true, permissions: [] }
const as = (body?: unknown): Event => ({ body, context: { adminUser: SUPER } })

const SMTP_SAVED = { smtp_host: 'smtp.real.vn', smtp_port: '587', smtp_secure: 'false', smtp_user: 'portal@real.vn', smtp_from: 'portal@real.vn' }
const R2_SAVED = { media_provider: 'r2', r2_account_id: '0123456789abcdef0123456789abcdef', r2_access_key: 'AKID', r2_bucket: 'cdkt-media', r2_public_url: 'https://cdn.example.vn' }

beforeEach(() => {
  process.env.CHATBOT_ENCRYPTION_SECRET = KEY
  store = new Map(Object.entries({ ...SMTP_SAVED, ...R2_SAVED }))
  transports.length = 0
  r2Clients.length = 0
})

const sealedWith = (key: Parameters<typeof secrets.sealSettingsSecret>[0], value: string, secret = KEY) => secrets.sealSettingsSecret(key, value, secret)

/** A stored value carries no part of the secret: not the text, not its last four characters. */
function assertNoPlaintext(stored: string | null | undefined, plaintext: string) {
  assert.ok(stored, 'nothing was stored')
  assert.ok(!stored.includes(plaintext), 'the stored row contains the secret')
  assert.ok(!stored.includes(plaintext.slice(-4)), 'the stored row contains the last four characters')
  assert.ok(!/lastFour/.test(stored), 'the envelope keeps a lastFour field')
}

// ─── The envelope ─────────────────────────────────────────────────────────────

test('each key seals under its own label and opens back to the plaintext', () => {
  for (const [key, label, value] of [
    ['smtp_pass', 'cdkt-smtp-pass:v1', SMTP_PASSWORD],
    ['r2_secret_key', 'cdkt-r2-secret:v1', R2_SECRET],
    ['backup_drive_service_account', 'cdkt-backup-drive-key:v1', SA_JSON],
  ] as const) {
    const stored = sealedWith(key, value)
    assert.equal(JSON.parse(stored).sealed, label)
    assertNoPlaintext(stored, value)
    assert.notEqual(stored, sealedWith(key, value), 'two seals of the same value must differ (random nonce)')
    assert.deepEqual(secrets.openSettingsSecret(key, stored), { state: 'sealed', value })
    assert.equal(secrets.isSettingsSecretEnvelope(stored), true)
  }
})

test('an envelope does not open under another key, nor under a rotated encryption secret', () => {
  const smtp = sealedWith('smtp_pass', SMTP_PASSWORD)
  assert.equal(secrets.openSettingsSecret('r2_secret_key', smtp).state, 'unreadable')
  assert.equal(secrets.openSettingsSecret('smtp_pass', smtp, ROTATED).state, 'unreadable')
  assert.equal(secrets.openSettingsSecret('smtp_pass', sealedWith('smtp_pass', SMTP_PASSWORD, ROTATED)).state, 'unreadable')
})

test('S2: anything shaped like an envelope fails CLOSED — an unknown label or missing fields is unreadable, never plaintext', async () => {
  const shapes = [
    JSON.stringify({ sealed: 'cdkt-unknown-feature:v9', version: 1, keyId: 'k', nonce: 'n', authTag: 't', ciphertext: 'c' }),
    JSON.stringify({ sealed: 'cdkt-smtp-pass:v1' }),
    JSON.stringify({ sealed: 'cdkt-smtp-pass:v2', version: 2, keyId: 'k', nonce: 'n', authTag: 't', ciphertext: 'c' }),
    JSON.stringify({ sealed: 42, ciphertext: 'c' }),
  ]
  for (const stored of shapes) {
    assert.deepEqual(secrets.openSettingsSecret('smtp_pass', stored), { state: 'unreadable', value: '' }, stored)
    assert.equal(secrets.isSettingsSecretEnvelope(stored), true, `${stored} would be encrypted again at boot`)
  }
  // The boot conversion leaves such a row alone and reports it.
  const rows = new Map<string, string | null>([['smtp_pass', shapes[0]!]])
  const connection = fakeConnection(rows)
  const report = await convertPlaintextSettingsSecrets(connection as never)
  assert.deepEqual(report.needsReentry, ['smtp_pass'])
  assert.equal(rows.get('smtp_pass'), shapes[0])
  // A use path never logs in with the stored string.
  store.set('smtp_pass', shapes[0]!)
  assert.equal((await getSmtpConfig())?.pass, '')
})

test('legacy plaintext (including service-account JSON) is recognised as not-an-envelope; empty is empty', () => {
  assert.deepEqual(secrets.openSettingsSecret('backup_drive_service_account', SA_JSON), { state: 'plaintext', value: SA_JSON })
  assert.equal(secrets.isSettingsSecretEnvelope(SA_JSON), false)
  assert.deepEqual(secrets.openSettingsSecret('smtp_pass', ''), { state: 'empty', value: '' })
  assert.deepEqual(secrets.openSettingsSecret('smtp_pass', null), { state: 'empty', value: '' })
})

// ─── Spec: saving the SMTP password ───────────────────────────────────────────

test('spec: saving the SMTP password stores an envelope without the password, and a test e-mail succeeds', async () => {
  await settingsPut(as({ settings: { ...SMTP_SAVED, smtp_pass: SMTP_PASSWORD } }))
  assertNoPlaintext(store.get('smtp_pass'), SMTP_PASSWORD)
  assert.equal(JSON.parse(store.get('smtp_pass')!).sealed, 'cdkt-smtp-pass:v1')

  const response = await testEmail(as({ to: 'officer@real.vn', ...SMTP_SAVED, smtp_pass: '********' }))
  assert.equal(response.ok, true)
  assert.deepEqual(transports.map(t => ({ host: t.host, pass: t.auth?.pass })), [{ host: 'smtp.real.vn', pass: SMTP_PASSWORD }])
  assert.equal((await getSmtpConfig())?.pass, SMTP_PASSWORD)
})

test('saving the R2 secret stores an envelope; R2 use and the R2 test get the plaintext', async () => {
  await settingsPut(as({ settings: { ...R2_SAVED, r2_secret_key: R2_SECRET } }))
  assertNoPlaintext(store.get('r2_secret_key'), R2_SECRET)
  assert.equal((await loadR2Config()).secretAccessKey, R2_SECRET)

  const response = await testR2(as({ accountId: R2_SAVED.r2_account_id, accessKeyId: 'AKID', bucket: 'cdkt-media', secretAccessKey: '********' }))
  assert.equal(response.ok, true)
  assert.deepEqual(r2Clients, [{ secretAccessKey: R2_SECRET }])
})

test('saving the Drive service account stores an envelope; the backup run gets the JSON back', async () => {
  await backupPut(as({ backup_drive_service_account: SA_JSON }))
  assertNoPlaintext(store.get('backup_drive_service_account'), SA_JSON)
  assert.ok(!store.get('backup_drive_service_account')!.includes('PRIVATE KEY'))
  const config = await readBackupConfig(fakeDb as never)
  assert.equal(config.driveServiceAccount, SA_JSON)
  assert.equal(config.driveServiceAccountUnreadable, false)
})

test('the mask round trip keeps the stored envelope byte for byte', async () => {
  store.set('smtp_pass', sealedWith('smtp_pass', SMTP_PASSWORD))
  store.set('r2_secret_key', sealedWith('r2_secret_key', R2_SECRET))
  store.set('backup_drive_service_account', sealedWith('backup_drive_service_account', SA_JSON))
  // The rest of the backup form, as a configured site has it.
  for (const [key, value] of Object.entries({ backup_auto_enabled: 'false', backup_auto_hour: '3', backup_auto_days: '[1]', backup_keep_count: '14', backup_drive_enabled: 'true', backup_drive_folder_id: 'folder-1' })) store.set(key, value)
  const before = new Map(store)

  const { settings } = await settingsGet(as()) as { settings: Record<string, string> }
  await settingsPut(as({ settings }))
  const backup = (await backupGet(as())).settings as Record<string, string | null>
  await backupPut(as(Object.fromEntries(Object.entries(backup).map(([k, v]) => [k, v ?? '']))))

  for (const key of secrets.SETTINGS_SECRET_KEYS) assert.equal(store.get(key), before.get(key), `${key} changed on a mask round trip`)
})

test('no settings response carries an envelope or a plaintext credential', async () => {
  store.set('smtp_pass', sealedWith('smtp_pass', SMTP_PASSWORD))
  store.set('r2_secret_key', sealedWith('r2_secret_key', R2_SECRET))
  store.set('backup_drive_service_account', sealedWith('backup_drive_service_account', SA_JSON))
  const text = JSON.stringify([await settingsGet(as()), await backupGet(as())])
  for (const fragment of [SMTP_PASSWORD, R2_SECRET, 'PRIVATE KEY', 'ciphertext', 'authTag', 'sealed', 'cdkt-smtp-pass']) {
    assert.ok(!text.includes(fragment), `a settings response carries ${fragment}`)
  }
})

test('without an encryption key a typed secret is refused (500), never stored as plaintext', async () => {
  delete process.env.CHATBOT_ENCRYPTION_SECRET
  const before = store.get('smtp_pass')
  await assert.rejects(settingsPut(as({ settings: { smtp_pass: SMTP_PASSWORD } })), (error: { statusCode?: number }) => error.statusCode === 500)
  await assert.rejects(backupPut(as({ backup_drive_service_account: SA_JSON })), (error: { statusCode?: number }) => error.statusCode === 500)
  assert.equal(store.get('smtp_pass'), before)
  assert.ok(!store.has('backup_drive_service_account'))
})

// ─── Spec: secret rotated ─────────────────────────────────────────────────────

test('spec: an undecryptable credential is reported as needing re-entry and the stored row is unchanged', async () => {
  const smtp = sealedWith('smtp_pass', SMTP_PASSWORD, ROTATED)
  const r2 = sealedWith('r2_secret_key', R2_SECRET, ROTATED)
  const sa = sealedWith('backup_drive_service_account', SA_JSON, ROTATED)
  store.set('smtp_pass', smtp)
  store.set('r2_secret_key', r2)
  store.set('backup_drive_service_account', sa)

  const general = await settingsGet(as()) as { settings: Record<string, string>, needsReentry: string[] }
  assert.deepEqual([...general.needsReentry].sort(), ['r2_secret_key', 'smtp_pass'])
  assert.equal(general.settings.smtp_pass, '********')
  assert.deepEqual((await backupGet(as())).needsReentry, ['backup_drive_service_account'])

  // Use paths: nothing is sent with an empty or envelope credential.
  const smtpConfig = await getSmtpConfig()
  assert.equal(smtpConfig?.pass, '')
  assert.equal(smtpConfig?.passUnreadable, true)
  await assert.rejects(sendMail({ to: 'x@real.vn', subject: 's', text: 't' }), /không giải mã được/)
  await assert.rejects(testEmail(as({ to: 'x@real.vn', smtp_pass: '********' })), /không giải mã được/)
  assert.equal(transports.length, 0, 'an SMTP login was attempted with an unreadable password')

  const r2Config = await loadR2Config()
  assert.equal(r2Config.secretAccessKey, '')
  assert.equal(r2Config.secretUnreadable, true)
  await assert.rejects(testR2(as({ secretAccessKey: '********' })), /không giải mã được/)
  assert.equal(r2Clients.length, 0)

  const backup = await readBackupConfig(fakeDb as never)
  assert.equal(backup.driveServiceAccount, '')
  assert.equal(backup.driveServiceAccountUnreadable, true)

  assert.equal(store.get('smtp_pass'), smtp)
  assert.equal(store.get('r2_secret_key'), r2)
  assert.equal(store.get('backup_drive_service_account'), sa)
})

// ─── Spec: upgrade (one-time boot conversion) ─────────────────────────────────

function fakeConnection(rows: Map<string, string | null>) {
  const statements: string[] = []
  return {
    statements,
    execute: async (statement: string, params: unknown[] = []) => {
      statements.push(statement)
      if (statement.startsWith('SELECT')) {
        return [[...rows].filter(([key]) => params.includes(key)).map(([key, value]) => ({ key, value })), []]
      }
      if (statement.startsWith('UPDATE')) {
        const [value, key, previous] = params as [string, string, string]
        if (rows.get(key) !== previous) return [{ affectedRows: 0 }, []]
        rows.set(key, value)
        return [{ affectedRows: 1 }, []]
      }
      throw new Error(`unexpected statement: ${statement}`)
    },
  }
}

test('spec: a database with plaintext credentials boots twice — envelopes after the first, nothing written by the second', async () => {
  const rows = new Map<string, string | null>([
    ['smtp_pass', SMTP_PASSWORD],
    ['r2_secret_key', R2_SECRET],
    ['backup_drive_service_account', SA_JSON],
    ['site_name', 'Không phải bí mật'],
  ])
  const first = fakeConnection(rows)
  const report = await convertPlaintextSettingsSecrets(first as never)
  assert.deepEqual([...report.converted].sort(), ['backup_drive_service_account', 'r2_secret_key', 'smtp_pass'])
  for (const [key, plaintext] of [['smtp_pass', SMTP_PASSWORD], ['r2_secret_key', R2_SECRET], ['backup_drive_service_account', SA_JSON]] as const) {
    assertNoPlaintext(rows.get(key), plaintext)
    assert.equal(secrets.openSettingsSecret(key, rows.get(key)).value, plaintext)
  }
  assert.equal(rows.get('site_name'), 'Không phải bí mật')

  const afterFirst = new Map(rows)
  const second = fakeConnection(rows)
  const again = await convertPlaintextSettingsSecrets(second as never)
  assert.deepEqual(again, { converted: [], needsReentry: [], skippedNoKey: [] })
  assert.equal(second.statements.filter(sql => sql.startsWith('UPDATE')).length, 0, 'the second boot wrote')
  assert.deepEqual(rows, afterFirst)
})

test('the conversion never overwrites an undecryptable envelope, and leaves empty values alone', async () => {
  const unreadable = sealedWith('smtp_pass', SMTP_PASSWORD, ROTATED)
  const rows = new Map<string, string | null>([['smtp_pass', unreadable], ['r2_secret_key', ''], ['backup_drive_service_account', null]])
  const connection = fakeConnection(rows)
  const report = await convertPlaintextSettingsSecrets(connection as never)
  assert.deepEqual(report.needsReentry, ['smtp_pass'])
  assert.deepEqual(report.converted, [])
  assert.equal(connection.statements.filter(sql => sql.startsWith('UPDATE')).length, 0)
  assert.equal(rows.get('smtp_pass'), unreadable)
  assert.equal(rows.get('r2_secret_key'), '')
})

test('without an encryption key the conversion writes nothing and reports what it could not convert', async () => {
  delete process.env.CHATBOT_ENCRYPTION_SECRET
  const rows = new Map<string, string | null>([['smtp_pass', SMTP_PASSWORD]])
  const connection = fakeConnection(rows)
  const report = await convertPlaintextSettingsSecrets(connection as never)
  assert.deepEqual(report.skippedNoKey, ['smtp_pass'])
  assert.equal(rows.get('smtp_pass'), SMTP_PASSWORD)
  assert.equal(connection.statements.filter(sql => sql.startsWith('UPDATE')).length, 0)
})

test('a row saved from the settings page between the read and the write is not overwritten by the conversion', async () => {
  const rows = new Map<string, string | null>([['smtp_pass', 'old-plaintext']])
  const connection = fakeConnection(rows)
  const execute = connection.execute
  connection.execute = async (statement: string, params: unknown[] = []) => {
    if (statement.startsWith('UPDATE')) rows.set('smtp_pass', sealedWith('smtp_pass', 'typed-meanwhile'))
    return execute(statement, params)
  }
  const report = await convertPlaintextSettingsSecrets(connection as never)
  assert.deepEqual(report.converted, [])
  assert.equal(secrets.openSettingsSecret('smtp_pass', rows.get('smtp_pass')).value, 'typed-meanwhile')
})

test('the boot sequence runs the conversion', () => {
  const source = readFileSync(new URL('../server/db/migrations-additive.ts', import.meta.url), 'utf8')
  assert.match(source, /await convertPlaintextSettingsSecrets\(db\)/)
})

test('legacy plaintext not yet converted (e.g. restored from an old dump) still works for use', async () => {
  store.set('smtp_pass', SMTP_PASSWORD)
  store.set('r2_secret_key', R2_SECRET)
  assert.equal((await getSmtpConfig())?.pass, SMTP_PASSWORD)
  assert.equal((await loadR2Config()).secretAccessKey, R2_SECRET)
})

// ─── Every read of the three keys goes through the envelope module ────────────

test('no server file reads a stored credential without going through settings-secrets', () => {
  const root = fileURLToPath(new URL('../server', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.ts')) files.push(full)
    }
  }
  walk(root)
  /** Files that name a key without reading the stored value, with the reason. */
  const NOT_A_STORED_READ: Record<string, string> = {
    'utils/smtp-test-config.ts': 'reads `smtp_pass` from the request BODY (a typed password), never from the table',
    'db/seed.ts': 'seeds an empty `r2_secret_key` row',
    'api/admin/settings/index.get.ts': 'returns only the mask; checks re-entry through settingsSecretNeedsReentry',
    'api/admin/settings/backup.get.ts': 'returns only the mask; checks re-entry through settingsSecretNeedsReentry',
  }
  const offenders: string[] = []
  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/')
    const source = readFileSync(file, 'utf8')
    if (!/['".]\s*(smtp_pass|r2_secret_key|backup_drive_service_account)\b/.test(source)) continue
    if (NOT_A_STORED_READ[rel] || rel === 'utils/settings-secrets.ts') continue
    if (!/from '[./]*(utils\/)?settings-secrets'|from '\.\.\/utils\/settings-secrets'|from '\.\/settings-secrets'/.test(source)) offenders.push(rel)
  }
  assert.deepEqual(offenders, [], 'these files touch a stored credential without the envelope helpers')
})

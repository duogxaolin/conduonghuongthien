import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Đích của backup (Google Drive) và số bản giữ lại là quyền của SuperAdmin.
 *
 * Trước đây `settings.update` là đủ để: trỏ backup sang service account / thư mục
 * Drive của mình (bản sao CSDL kế tiếp — hash mật khẩu, đơn của người dân — rơi
 * vào Drive của họ), liên kết Drive OAuth bằng tài khoản Google của mình, và đặt
 * `backup_keep_count=1` rồi bấm "chạy backup" để xoá sạch lịch sử. Các test dưới
 * đây CHẠY handler thật với kho `settings` giả và service Drive giả.
 *
 * Người có `settings.update` vẫn phải lưu được lịch backup — kể cả khi biểu mẫu
 * gửi kèm nguyên các ô Drive/keep_count không đổi (biểu mẫu luôn gửi đủ 7 ô).
 */

const store = new Map<string, string>()
const audits: Array<Record<string, unknown>> = []
const serviceCalls: string[] = []

const tx = {
  insert: () => ({
    values: (value: Record<string, unknown>) => {
      if ('action' in value) { audits.push(value); return Promise.resolve() }
      return { onDuplicateKeyUpdate: async () => { store.set(String(value.key), String(value.value)) } }
    },
  }),
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: () => ({ from: async () => [...store].map(([key, value]) => ({ key, value })) }),
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    }),
  },
})

const record = (name: string, result: unknown = undefined) => async (..._args: unknown[]) => { serviceCalls.push(name); return result }
const CONFIG_ROW = { clientId: 'cid', isEnabled: true }
mock.module('../server/services/backup-drive-oauth-config', {
  namedExports: {
    BackupDriveOauthConfigValidationError: class extends Error {},
    getDriveOauthConfigRow: record('getDriveOauthConfigRow', CONFIG_ROW),
    serializeDriveOauthConfig: () => ({ clientId: 'cid' }),
    updateDriveOauthConfig: record('updateDriveOauthConfig'),
    clearDriveOauthSecret: record('clearDriveOauthSecret'),
    getUsableDriveOauthConfig: record('getUsableDriveOauthConfig', { ok: false, reason: 'disabled' }),
  },
})
mock.module('../server/services/backup-drive-oauth', {
  namedExports: {
    clearDriveLink: record('clearDriveLink'),
    storeDriveLink: record('storeDriveLink'),
    getDriveLinkRow: record('getDriveLinkRow', null),
    serializeDriveLink: () => ({ linked: false }),
  },
})
mock.module('../server/utils/google-oauth/config', {
  namedExports: {
    GOOGLE_AUTH_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
    GOOGLE_TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
    DRIVE_SCOPE: 'drive.file',
    resolveDriveRedirectUri: () => 'https://portal.example/api/admin/backup/drive/callback',
  },
})
mock.module('../server/utils/google-oauth/state', {
  namedExports: {
    stateSigningKey: () => Buffer.alloc(32),
    verifyState: () => { serviceCalls.push('verifyState'); return { ok: false, reason: 'missing' } },
    issueState: () => 'signed-state',
  },
})
mock.module('../server/utils/google-oauth/id-token', { namedExports: { decodeIdTokenClaims: () => null } })
mock.module('../server/utils/logger', { namedExports: { logWarn: () => {}, logInfo: () => {}, logError: () => {} } })

const h3 = await import('h3')
type FakeEvent = { context: { adminUser: unknown, requestId?: string }, body?: unknown }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = h3.createError
globals.readBody = async (event: FakeEvent) => event.body
globals.getQuery = () => ({})
globals.getCookie = () => { serviceCalls.push('getCookie'); return undefined }
globals.deleteCookie = () => { serviceCalls.push('deleteCookie') }
globals.setCookie = () => { serviceCalls.push('setCookie') }
globals.sendRedirect = (_event: unknown, location: string) => ({ redirect: location })
globals.getRequestURL = () => new URL('https://portal.example/api/admin/backup/drive/start')
globals.getRequestHeader = () => undefined

type Handler = (event: FakeEvent) => Promise<unknown>
const load = async (file: string) => (await import(`../server/api/admin/${file}`)).default as Handler
const backupPut = await load('settings/backup.put.ts')
const drive = {
  'config.put': await load('backup/drive/config.put.ts'),
  'start.get': await load('backup/drive/start.get.ts'),
  'callback.get': await load('backup/drive/callback.get.ts'),
  'clear-secret.post': await load('backup/drive/clear-secret.post.ts'),
  'disconnect.post': await load('backup/drive/disconnect.post.ts'),
}
const driveReads = {
  'config.get': await load('backup/drive/config.get.ts'),
  'status.get': await load('backup/drive/status.get.ts'),
}

const ALL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true }
const EDITOR = { id: 9, isSuperAdmin: false, permissions: [{ resource: 'settings', ...ALL }] }
const SUPER = { id: 1, isSuperAdmin: true, permissions: [] }

async function statusOf(promise: Promise<unknown>): Promise<number | null> {
  try { await promise; return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

const SECRET_JSON = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----SECRET"}'
const STORED = {
  backup_auto_enabled: 'true', backup_auto_hour: '3', backup_auto_days: '[1,3]',
  backup_keep_count: '2', backup_drive_enabled: 'true', backup_drive_service_account: SECRET_JSON, backup_drive_folder_id: 'folder-real',
}
/** What `useBackupSettings` sends after loading STORED as a settings editor (service account masked). */
const EDITOR_FORM = { ...STORED, backup_drive_service_account: '********' }

function reset(entries: Record<string, string> = STORED) {
  store.clear()
  for (const [key, value] of Object.entries(entries)) store.set(key, value)
  audits.length = 0
  serviceCalls.length = 0
}

const put = (body: Record<string, unknown>, actor: unknown = EDITOR) => backupPut({ body, context: { adminUser: actor } })

// ─── settings/backup.put.ts ──────────────────────────────────────────────────

const SUPERADMIN_CHANGES: Array<[string, Record<string, unknown>]> = [
  ['service account', { backup_drive_service_account: '{"type":"service_account","private_key":"ATTACKER"}' }],
  ['service account cleared', { backup_drive_service_account: '' }],
  ['Drive folder', { backup_drive_folder_id: 'attacker-folder' }],
  ['Drive switch off', { backup_drive_enabled: 'false' }],
  ['keep count', { backup_keep_count: '1' }],
  ['keep count raised', { backup_keep_count: '30' }],
]

for (const [label, change] of SUPERADMIN_CHANGES) {
  test(`settings editor changing ${label}: 403 and nothing written (not even the schedule sent alongside)`, async () => {
    reset()
    assert.equal(await statusOf(put({ ...EDITOR_FORM, backup_auto_hour: '5', ...change })), 403)
    assert.deepEqual(Object.fromEntries(store), STORED)
    assert.equal(audits.length, 0)
  })

  test(`superadmin changing ${label}: saved`, async () => {
    reset()
    assert.equal(await statusOf(put({ ...EDITOR_FORM, ...change }, SUPER)), null)
    const [key, value] = Object.entries(change)[0]!
    assert.equal(store.get(key), String(value))
  })
}

test('settings editor resubmitting the loaded form with a new schedule: 200, schedule saved, Drive/keep untouched', async () => {
  reset()
  assert.equal(await statusOf(put({ ...EDITOR_FORM, backup_auto_hour: '5', backup_auto_days: '[0,6]' })), null)
  assert.equal(store.get('backup_auto_hour'), '5')
  assert.equal(store.get('backup_auto_days'), '[0,6]')
  assert.equal(store.get('backup_drive_service_account'), SECRET_JSON)
  assert.equal(store.get('backup_keep_count'), '2', 'a stored value below the new floor is a no-op on resubmit, not a 400')
})

test('first save on an empty database: the page defaults (14, false, empty) are not a change', async () => {
  reset({})
  const defaults = {
    backup_auto_enabled: 'true', backup_auto_hour: '3', backup_auto_days: '[1]',
    backup_keep_count: '14', backup_drive_enabled: 'false', backup_drive_service_account: '', backup_drive_folder_id: '',
  }
  assert.equal(await statusOf(put(defaults)), null)
  assert.equal(store.get('backup_auto_enabled'), 'true')
  assert.ok(!store.has('backup_keep_count') && !store.has('backup_drive_enabled'), 'unchanged superadmin-only keys are not written')
  // A numeric keep count from `<input type="number">` is the same value.
  assert.equal(await statusOf(put({ ...defaults, backup_keep_count: 14 })), null)
})

test('invalid values are a 400, not a 500', async () => {
  reset()
  for (const body of [{ backup_auto_hour: '25' }, { backup_auto_days: 'x' }, { backup_auto_enabled: 'maybe' }, { backup_keep_count: '0' }, { backup_keep_count: 'abc' }]) {
    assert.equal(await statusOf(put(body, SUPER)), 400, JSON.stringify(body))
  }
})

test('the audit row never quotes the service-account key', async () => {
  reset()
  await put({ backup_drive_service_account: '{"type":"service_account","private_key":"NEW"}' }, SUPER)
  assert.equal(audits.length, 1)
  assert.ok(!JSON.stringify(audits).includes('SECRET'), JSON.stringify(audits))
  assert.ok(!JSON.stringify(audits).includes('NEW'))
})

// ─── Drive OAuth endpoints ───────────────────────────────────────────────────

for (const [name, handler] of Object.entries(drive)) {
  test(`drive ${name}: settings editor gets 403 before any service, cookie or state work`, async () => {
    reset()
    assert.equal(await statusOf(handler({ body: { clientId: 'attacker' }, context: { adminUser: EDITOR } })), 403)
    assert.deepEqual(serviceCalls, [])
  })

  test(`drive ${name}: superadmin passes the gate`, async () => {
    reset()
    assert.equal(await statusOf(handler({ body: { clientId: 'cid' }, context: { adminUser: SUPER } })), null)
    assert.ok(serviceCalls.length > 0, 'the handler went on to do its work')
  })
}

for (const [name, handler] of Object.entries(driveReads)) {
  test(`drive ${name}: a settings editor can still READ the Drive status`, async () => {
    reset()
    assert.equal(await statusOf(handler({ context: { adminUser: EDITOR } })), null)
  })
}

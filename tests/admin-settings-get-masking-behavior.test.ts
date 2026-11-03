import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'

/**
 * The admin settings READ endpoints never hand out a stored credential (spec
 * admin-settings-secrets, design D1).
 *
 * `GET /api/admin/settings` returned EVERY row of the `settings` table and masked
 * by a deny-list: two keys, and one of them only for non-SuperAdmins. Every key
 * added later leaked by default — and one did: `backup_drive_service_account`, the
 * Google service-account JSON with its `private_key`, went to anyone holding
 * `settings.read`. `GET /api/admin/settings/backup` masked it, but not for a
 * SuperAdmin.
 *
 * Now the general read is an ALLOWLIST of the keys the five settings pages read,
 * and the four stored credentials are `********` for every caller. The REAL
 * handlers run here against an in-memory `settings` table.
 */

const SA_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'backup@proj.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n',
})
const R2_SECRET = 'r2-secret-value-abcdef0123456789'
const VIDEO_SECRET = 'video-r2-secret-value-9876543210'
const SMTP_PASS = 'smtp-password-value-xyz'

const store = new Map<string, string | null>()
const tx = {
  insert: () => ({
    values: (value: Record<string, unknown>) => {
      if ('action' in value) return Promise.resolve()
      return { onDuplicateKeyUpdate: async () => { store.set(String(value.key), String(value.value)) } }
    },
  }),
}
mock.module('../server/utils/db', {
  namedExports: {
    // `where` is accepted and ignored: the handler must not rely on the query
    // alone to keep keys out of the response.
    getDb: () => ({
      select: () => ({
        from: () => {
          const rows = async () => [...store].map(([key, value]) => ({ key, value }))
          const result = rows()
          return Object.assign(result, { where: () => rows() })
        },
      }),
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    }),
  },
})
const forbidden = () => Object.assign(new Error('Forbidden'), { statusCode: 403 })
mock.module('../server/utils/permissions', {
  namedExports: {
    requireResourcePermission: () => {},
    requireSuperAdmin: (user: { isSuperAdmin?: boolean }) => { if (user?.isSuperAdmin !== true) throw forbidden() },
  },
})
type Event = { body?: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

type SettingsResponse = { ok: boolean, settings: Record<string, string | null> }
const generalModule = await import('../server/api/admin/settings/index.get')
const general = generalModule.default as unknown as (event: Event) => Promise<SettingsResponse>
const backupGet = (await import('../server/api/admin/settings/backup.get')).default as unknown as (event: Event) => Promise<SettingsResponse>
const backupPut = (await import('../server/api/admin/settings/backup.put')).default as unknown as (event: Event) => Promise<{ ok: boolean }>

const EDITOR = { id: 5, isSuperAdmin: false }
const SUPERADMIN = { id: 1, isSuperAdmin: true }
const as = (adminUser: unknown, body?: unknown): Event => ({ body, context: { adminUser } })

// ─── What the five pages actually read, taken from their source ───────────────
const script = (page: string) => {
  const sfc = parse(readFileSync(new URL(`../app/pages/admin/settings/${page}.vue`, import.meta.url), 'utf8'))
  return sfc.descriptor.scriptSetup?.content ?? ''
}
const reactiveKeys = (source: string) => {
  const body = /const settings = reactive\(\{([\s\S]*?)\}\)/.exec(source)?.[1] ?? ''
  return [...body.matchAll(/^\s*([a-z0-9_]+):/gm)].map(m => m[1]!)
}
const PAGE_KEYS: Record<string, string[]> = {
  general: [.../GENERAL_KEYS = \[([\s\S]*?)\]/.exec(script('general'))![1]!.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]!),
  tracking: reactiveKeys(script('tracking')),
  email: reactiveKeys(script('email')),
  'media-storage': reactiveKeys(script('media-storage')),
  // Reads `res.settings` into `s` / `ms` and picks the R2 fields off it.
  'media-portal': [...new Set([...script('media-portal').matchAll(/\b(?:s|ms)\.([a-z0-9]+_[a-z0-9_]+)/g)].map(m => m[1]!))],
}

/** Every key the pages read, plus everything that must never come back. */
function seed() {
  store.clear()
  for (const keys of Object.values(PAGE_KEYS)) for (const key of keys) store.set(key, `value-of-${key}`)
  store.set('r2_secret_key', R2_SECRET)
  store.set('smtp_pass', SMTP_PASS)
  store.set('backup_auto_enabled', 'false')
  store.set('backup_auto_hour', '3')
  store.set('backup_auto_days', '[]')
  store.set('backup_drive_enabled', 'true')
  store.set('backup_drive_service_account', SA_JSON)
  store.set('backup_drive_folder_id', 'FOLDER-1')
  store.set('backup_keep_count', '30')
  store.set('retention_activity_logs_days', '365')
  store.set('media_video_r2_secret_key', VIDEO_SECRET)
  store.set('media_video_r2_account_id', 'a'.repeat(32))
  store.set('nav_menu_navbar', '[]')
  store.set('a_key_added_next_year', 'surprise')
}

const SECRET_SUBSTRINGS = ['private_key', 'BEGIN PRIVATE KEY', 'MIIEvQ', R2_SECRET, VIDEO_SECRET, SMTP_PASS]

test('the per-page key lists were read from the pages (guards against an empty, vacuous list)', () => {
  assert.ok(PAGE_KEYS.general!.includes('site_name') && PAGE_KEYS.general!.includes('og_image_url'))
  assert.ok(PAGE_KEYS.tracking!.includes('tracking_custom_head'))
  assert.ok(PAGE_KEYS.email!.includes('smtp_pass'))
  assert.ok(PAGE_KEYS['media-storage']!.includes('r2_secret_key'))
  assert.ok(PAGE_KEYS['media-portal']!.includes('r2_bucket'))
})

for (const [role, user] of [['editor', EDITOR], ['SuperAdmin', SUPERADMIN]] as const) {
  test(`GET /api/admin/settings (${role}): no stored credential and no unlisted key in the response`, async () => {
    seed()
    const response = await general(as(user))
    const text = JSON.stringify(response)
    for (const secret of SECRET_SUBSTRINGS) assert.ok(!text.includes(secret), `${role} received ${secret.slice(0, 16)}…`)
    assert.equal(response.settings.r2_secret_key, '********')
    assert.equal(response.settings.smtp_pass, '********')
    for (const key of ['a_key_added_next_year', 'nav_menu_navbar', 'backup_drive_service_account', 'backup_drive_folder_id', 'backup_keep_count', 'retention_activity_logs_days', 'media_video_r2_secret_key', 'media_video_r2_account_id']) {
      assert.ok(!(key in response.settings), `${role} received ${key}`)
    }
  })

  test(`GET /api/admin/settings (${role}): every key each settings page reads is still there`, async () => {
    seed()
    const { settings } = await general(as(user))
    for (const [page, keys] of Object.entries(PAGE_KEYS)) {
      for (const key of keys) assert.ok(key in settings && settings[key] !== null, `${page}.vue reads ${key}, the response lacks it`)
    }
  })

  test(`GET /api/admin/settings/backup (${role}): the service account is masked, nothing of the JSON leaves`, async () => {
    seed()
    const response = await backupGet(as(user))
    const text = JSON.stringify(response)
    for (const secret of SECRET_SUBSTRINGS) assert.ok(!text.includes(secret), `${role} received ${secret.slice(0, 16)}…`)
    assert.equal(response.settings.backup_drive_service_account, '********')
    assert.equal(response.settings.backup_drive_folder_id, 'FOLDER-1', 'non-secret backup settings are still returned')
    assert.equal(response.settings.backup_keep_count, '30')
  })
}

test('an empty credential stays empty — the pages read "no value" as "not configured"', async () => {
  seed()
  store.set('r2_secret_key', '')
  store.set('smtp_pass', null)
  store.set('backup_drive_service_account', '')
  const { settings } = await general(as(SUPERADMIN))
  assert.equal(settings.r2_secret_key, '')
  assert.equal(settings.smtp_pass, null)
  assert.equal((await backupGet(as(SUPERADMIN))).settings.backup_drive_service_account, '')
})

test('round trip: a SuperAdmin saving the backup form with the mask keeps the stored service account', async () => {
  seed()
  const { settings } = await backupGet(as(SUPERADMIN))
  const body = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, value ?? '']))
  body.backup_drive_folder_id = 'FOLDER-2'
  assert.deepEqual(await backupPut(as(SUPERADMIN, body)), { ok: true })
  assert.equal(store.get('backup_drive_service_account'), SA_JSON, 'the mask must never overwrite the stored JSON')
  assert.equal(store.get('backup_drive_folder_id'), 'FOLDER-2', 'the rest of the form is saved')
})

test('media-portal.vue no longer copies (or promises) a Secret Key read back from the settings endpoint', () => {
  // "Dùng R2 của Media Storage" used to fill the video Secret Key from
  // `r2_secret_key` "for a SuperAdmin". The endpoint now masks it for everyone, so
  // that branch could only ever copy the mask, and its toast promised the officer
  // something no role gets.
  const source = script('media-portal')
  assert.doesNotMatch(source, /chỉ SuperAdmin thấy sẵn/)
  assert.doesNotMatch(source, /videoR2SecretKey\s*=\s*s\.r2_secret_key/)
  assert.match(source, /Secret Key[^'`]*nhập tay/)
})

test('the read allowlist is one exported constant: the union of the pages, the same keys the PUT accepts', () => {
  const { SETTINGS_READ_KEYS } = generalModule as unknown as { SETTINGS_READ_KEYS?: readonly string[] }
  assert.ok(Array.isArray(SETTINGS_READ_KEYS), 'index.get.ts must export SETTINGS_READ_KEYS')
  const union = new Set(Object.values(PAGE_KEYS).flat())
  assert.deepEqual([...new Set(SETTINGS_READ_KEYS)].sort(), [...union].sort())

  // Read and write must agree: a key a page can save but not load (or the
  // reverse) is a form that silently shows a default over the stored value.
  const put = readFileSync(new URL('../server/api/admin/settings/index.put.ts', import.meta.url), 'utf8')
  const writable = [.../const ALLOWED_SETTING_KEYS = new Set\(\[([\s\S]*?)\]\)/.exec(put)![1]!.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]!)
  assert.deepEqual([...new Set(SETTINGS_READ_KEYS)].sort(), [...new Set(writable)].sort())
})

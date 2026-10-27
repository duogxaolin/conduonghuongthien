import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { BACKUP_SUPERADMIN_ONLY_KEYS, backupSettingsPayload, type BackupSettingsForm } from '../app/utils/backup-settings-payload'
import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'

/**
 * The "Cài đặt backup" block on /admin/settings/backup, against the server rule
 * F1 added in `server/api/admin/settings/backup.put.ts`: only a SuperAdmin may
 * CHANGE where backups go (Google Drive: service account, folder, upload switch,
 * OAuth link) or how many are kept (`backup_keep_count` — rotation deletes the rest).
 *
 * The UI must match: a delegated settings editor sees those controls disabled or
 * hidden, and the save request leaves the four keys out entirely — so a schedule
 * change by a non-SuperAdmin is never a 403, even when the form holds defaults
 * because loading failed. The payload is run through the REAL handler below, so the
 * client's key list cannot drift from the server's.
 */

// ─── Real PUT handler with an in-memory settings table ────────────────────────
const store = new Map<string, string>()
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
    getDb: () => ({
      select: () => ({ from: async () => [...store].map(([key, value]) => ({ key, value })) }),
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
type Event = { body: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
const handler = (await import('../server/api/admin/settings/backup.put')).default as unknown as (event: Event) => Promise<{ ok: boolean }>

const STORED = {
  backup_auto_enabled: 'false',
  backup_auto_hour: '3',
  backup_auto_days: '[]',
  backup_keep_count: '30',
  backup_drive_enabled: 'true',
  backup_drive_service_account: '{"type":"service_account","client_email":"real@corp.iam"}',
  backup_drive_folder_id: 'REAL-FOLDER',
}
/** What the form holds after the GET failed (composable defaults) and the officer edits the schedule. */
const DEFAULTS_FORM: BackupSettingsForm = {
  backup_auto_enabled: 'true',
  backup_auto_hour: '2',
  backup_auto_days: '[]',
  backup_keep_count: '14',
  backup_drive_enabled: 'false',
  backup_drive_service_account: '',
  backup_drive_folder_id: '',
}
const seed = () => { store.clear(); for (const [k, v] of Object.entries(STORED)) store.set(k, v) }
const put = (body: Record<string, string>, isSuperAdmin: boolean) => handler({ body, context: { adminUser: { id: 5, isSuperAdmin } } })

test('non-SuperAdmin payload omits exactly the four SuperAdmin-only keys; SuperAdmin payload sends everything', () => {
  const nonSa = backupSettingsPayload(DEFAULTS_FORM, [1, 3], false)
  for (const key of BACKUP_SUPERADMIN_ONLY_KEYS) assert.ok(!(key in nonSa), key)
  assert.deepEqual(nonSa, { backup_auto_enabled: 'true', backup_auto_hour: '2', backup_auto_days: '[1,3]' })
  const sa = backupSettingsPayload(DEFAULTS_FORM, [1, 3], true)
  assert.deepEqual(Object.keys(sa).sort(), Object.keys(DEFAULTS_FORM).sort())
  assert.equal(sa.backup_auto_days, '[1,3]')
})

test('real handler: the non-SuperAdmin payload saves the schedule and leaves Drive/keep-count untouched (no 403)', async () => {
  seed()
  const result = await put(backupSettingsPayload(DEFAULTS_FORM, [0, 6], false), false)
  assert.equal(result.ok, true)
  assert.equal(store.get('backup_auto_enabled'), 'true')
  assert.equal(store.get('backup_auto_hour'), '2')
  assert.equal(store.get('backup_auto_days'), '[0,6]')
  for (const key of BACKUP_SUPERADMIN_ONLY_KEYS) assert.equal(store.get(key), STORED[key], key)
})

test('real handler: why the keys must be omitted — the full form with different values is a 403 for a non-SuperAdmin', async () => {
  seed()
  await assert.rejects(put({ ...DEFAULTS_FORM }, false), (error: { statusCode?: number }) => error.statusCode === 403)
  assert.equal(store.get('backup_auto_hour'), '3', 'nothing saved')
})

test('real handler: a SuperAdmin payload still changes Drive and keep-count', async () => {
  seed()
  await put(backupSettingsPayload({ ...DEFAULTS_FORM, backup_keep_count: '7', backup_drive_folder_id: 'NEW' }, [], true), true)
  assert.equal(store.get('backup_keep_count'), '7')
  assert.equal(store.get('backup_drive_folder_id'), 'NEW')
})

// ─── The panel and its composable ─────────────────────────────────────────────
const panel = parse(readFileSync(new URL('../app/components/admin/backup/BackupSettingsPanel.vue', import.meta.url), 'utf8'), { filename: 'BackupSettingsPanel.vue' })
const template = panel.descriptor.template?.content ?? ''
const panelScript = panel.descriptor.scriptSetup?.content ?? ''
const composable = readFileSync(new URL('../app/composables/useBackupSettings.ts', import.meta.url), 'utf8')

test('panel: SuperAdmin-only controls are disabled or not rendered for other roles, with a note', () => {
  assert.equal(panel.errors.length, 0)
  assert.match(template, /v-model="backupSettings\.backup_keep_count"[^>]*:disabled="!isSuperAdmin"/)
  assert.match(template, /v-model="backupSettings\.backup_drive_enabled"[^>]*:disabled="!isSuperAdmin"/)
  // OAuth credentials form, service account and folder only render for a SuperAdmin.
  assert.match(template, /v-else-if="isSuperAdmin"[\s\S]{0,200}v-model="driveClientId"/)
  assert.match(template, /<template v-if="isSuperAdmin">[\s\S]{0,300}backup_drive_service_account[\s\S]{0,600}backup_drive_folder_id[\s\S]{0,200}<\/template>/)
  // Disconnect / remove-broken-link buttons and the "connect" link.
  for (const m of template.matchAll(/<button\b[^>]*@click="disconnectDrive"/g)) assert.match(m[0], /v-if="isSuperAdmin"/)
  assert.match(template, /v-else-if="!isSuperAdmin"[\s\S]{0,200}<\/div>\s*<div v-else-if="driveConfig\?\.isEnabled"[\s\S]{0,200}href="\/api\/admin\/backup\/drive\/start"/)
  assert.match(template, /v-if="!isSuperAdmin"[^>]*>[\s\S]{0,200}Chỉ quản trị viên cấp cao/)
})

test('panel: a failed settings load blocks saving (defaults would overwrite real config) and offers a retry', () => {
  assert.match(template, /:disabled="savingSettings \|\| !settingsLoaded"/)
  assert.match(template, /v-if="settingsLoadError" role="alert"[\s\S]{0,400}@click="loadSettings\(\)"/)
  assert.match(composable, /settingsLoadError\.value = errorMessage\(err, /)
  assert.match(composable, /if \(!settingsLoaded\.value\) return/)
  assert.match(composable, /backupSettingsPayload\(backupSettings\.value, selectedDays\.value, isSuperAdmin\.value\)/)
  // Bare `$fetch` or `adminFetch<T>()` (D-FETCH): either would be a request outside the composable.
  assert.doesNotMatch(panelScript, ADMIN_FETCH_CALL, 'network calls stay in the composable')
  assert.match(composable, /\badminFetch</, 'the composable makes them')
})

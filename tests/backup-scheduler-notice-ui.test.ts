import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { renderSfcTemplate } from './_render-sfc-template'

/**
 * Spec `backup-restore`, "Server disabled the scheduler": when the server does not
 * run the backup scheduler (`BACKUP_SCHEDULER=0`, or outside production), the
 * admin switch "Backup tự động theo lịch" saves but nothing ever runs. Before
 * wave1 D10 that was production's silent state. `GET /api/admin/settings/backup`
 * now says so (`schedulerDisabledByServer`) and the panel shows a one-line notice.
 */

mock.module('../server/utils/db', {
  namedExports: { getDb: () => ({ select: () => ({ from: async () => [{ key: 'backup_auto_enabled', value: 'true' }] }) }) },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
type Response = { ok: boolean, settings: Record<string, string | null>, schedulerDisabledByServer: boolean }
const handler = (await import('../server/api/admin/settings/backup.get')).default as unknown as (event: unknown) => Promise<Response>

async function getWith(env: { BACKUP_SCHEDULER?: string, NODE_ENV?: string }): Promise<Response> {
  const previous = { BACKUP_SCHEDULER: process.env.BACKUP_SCHEDULER, NODE_ENV: process.env.NODE_ENV }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await handler({ context: { adminUser: { id: 1, isSuperAdmin: true } } })
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('GET /api/admin/settings/backup reports whether the server runs the scheduler', async () => {
  assert.equal((await getWith({ BACKUP_SCHEDULER: '0', NODE_ENV: 'production' })).schedulerDisabledByServer, true)
  assert.equal((await getWith({ BACKUP_SCHEDULER: undefined, NODE_ENV: 'production' })).schedulerDisabledByServer, false)
  assert.equal((await getWith({ BACKUP_SCHEDULER: undefined, NODE_ENV: 'development' })).schedulerDisabledByServer, true)
  const response = await getWith({ BACKUP_SCHEDULER: '1', NODE_ENV: 'development' })
  assert.equal(response.schedulerDisabledByServer, false)
  assert.ok(!('schedulerDisabledByServer' in response.settings), 'the flag is not a setting — the form must never PUT it back')
})

const PANEL = new URL('../app/components/admin/backup/BackupSettingsPanel.vue', import.meta.url).pathname

/** Every binding the panel's template reads, as plain values. */
const panelState = (schedulerDisabledByServer: boolean) => ({
  isSuperAdmin: true, settingsLoaded: true, settingsLoadError: '', loadSettings: () => {},
  backupSettings: {
    backup_auto_enabled: 'true', backup_auto_hour: '3', backup_auto_days: '[]', backup_keep_count: '14',
    backup_drive_enabled: 'false', backup_drive_service_account: '', backup_drive_folder_id: '',
  },
  selectedDays: [], daysOptions: [{ label: 'CN', value: 0 }], savingSettings: false, saveSettings: () => {},
  schedulerDisabledByServer,
  driveLink: null, driveRedirectUri: '', driveLinkLoading: false, disconnecting: false, driveToast: '',
  disconnectDrive: () => {}, copyRedirectUri: () => {},
  driveConfig: null, driveConfigLoading: false, savingDriveConfig: false, clearingDriveSecret: false,
  driveClientId: '', driveClientSecret: '', driveEnabled: false, saveDriveConfig: () => {}, clearDriveSecret: () => {},
  formatWhen: (value: string) => value,
})

test('the panel shows a one-line notice when the server has the scheduler disabled', async () => {
  const html = await renderSfcTemplate(PANEL, panelState(true))
  const notice = /<p[^>]*data-testid="backup-scheduler-disabled"[^>]*>([\s\S]*?)<\/p>/.exec(html)
  assert.ok(notice, 'no notice rendered')
  const text = notice[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  assert.match(text, /máy chủ/i)
  assert.match(text, /không chạy/)
  assert.doesNotMatch(text, /BACKUP_SCHEDULER/, 'no implementation detail in the UI (openspec/ui-dna.md)')
  assert.match(notice[0], /<i [^>]*aria-hidden="true"/, 'the icon is decorative; the text carries the state')
})

test('no notice while the server runs the scheduler', async () => {
  const html = await renderSfcTemplate(PANEL, panelState(false))
  assert.doesNotMatch(html, /backup-scheduler-disabled/)
})

test('the composable reads the flag from the GET response, outside the form payload', () => {
  const composable = readFileSync(new URL('../app/composables/useBackupSettings.ts', import.meta.url), 'utf8')
  assert.match(composable, /schedulerDisabledByServer\.value = res\.schedulerDisabledByServer === true/)
  const payload = readFileSync(new URL('../app/utils/backup-settings-payload.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(payload, /schedulerDisabledByServer/)
})

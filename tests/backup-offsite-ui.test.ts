import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { renderSfcTemplate } from './_render-sfc-template'
import { OFFSITE_STATUSES, isBackupLocalOnly, offsiteDestinationConfigured, offsiteStatusDisplay } from '../shared/backup-offsite-status'

/**
 * Spec `backup-restore` (wave2 D-OFFSITE): "The backup page warns when no off-VPS
 * destination exists" — automatic backups on and Drive not configured → the page
 * says the backups exist only on the server. And each listed backup says whether it
 * has an off-site copy, in words (openspec/ui-dna.md: a state is never colour or an
 * unlabelled icon alone — the old Drive column was an `aria-hidden` circle).
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const form = (over: Partial<Record<'backup_auto_enabled' | 'backup_drive_enabled' | 'backup_drive_service_account', string>> = {}) => ({
  backup_auto_enabled: 'true', backup_drive_enabled: 'false', backup_drive_service_account: '', ...over,
})

// ─── The rule ─────────────────────────────────────────────────────────────────
test('one rule decides "configured" for the server and the page', () => {
  assert.deepEqual([...OFFSITE_STATUSES], ['uploaded', 'failed', 'none'])
  assert.equal(offsiteDestinationConfigured({ driveEnabled: false, oauthLinked: true, serviceAccountConfigured: true }), false)
  assert.equal(offsiteDestinationConfigured({ driveEnabled: true, oauthLinked: false, serviceAccountConfigured: false }), false)
  assert.equal(offsiteDestinationConfigured({ driveEnabled: true, oauthLinked: true, serviceAccountConfigured: false }), true)
  assert.equal(offsiteDestinationConfigured({ driveEnabled: true, oauthLinked: false, serviceAccountConfigured: true }), true)
  // The server's Drive phase and the page's warning both go through it.
  assert.match(read('server/services/backup-offsite.ts'), /offsiteDestinationConfigured\(\{/)
  assert.match(/export function isBackupLocalOnly[\s\S]*?\n\}/.exec(read('shared/backup-offsite-status.ts'))?.[0] ?? '', /offsiteDestinationConfigured\(\{/)
  // app/ reaches shared/ through the alias: a relative import from app/ is emitted as a
  // broken relative path in the SSR build (Nuxt keeps shared/ external) — Nitro build red.
  for (const file of ['app/composables/useBackupSettings.ts', 'app/components/admin/backup/BackupOffsiteBadge.vue', 'app/pages/admin/settings/backup.vue']) {
    assert.match(read(file), /from '~~\/shared\/backup-offsite-status'/, file)
    assert.doesNotMatch(read(file), /from '(\.\.\/)+shared\//, file)
  }
})

test('spec "Local only": auto backups on and Drive off → warn', () => {
  assert.equal(isBackupLocalOnly(form(), 'not_linked'), true)
  // Drive off: no link state can change that — even while the link status is unknown.
  assert.equal(isBackupLocalOnly(form(), null), true)
})

test('Drive switched on but with no account and no service account is still local only', () => {
  assert.equal(isBackupLocalOnly(form({ backup_drive_enabled: 'true' }), 'not_linked'), true)
})

test('no warning once Drive has somewhere to go, or while automatic backups are off', () => {
  assert.equal(isBackupLocalOnly(form({ backup_drive_enabled: 'true' }), 'linked'), false)
  assert.equal(isBackupLocalOnly(form({ backup_drive_enabled: 'true', backup_drive_service_account: '********' }), 'not_linked'), false)
  // A broken link is a configured destination; the per-backup status says "failed".
  assert.equal(isBackupLocalOnly(form({ backup_drive_enabled: 'true' }), 'secret_unreadable'), false)
  assert.equal(isBackupLocalOnly(form({ backup_auto_enabled: 'false' }), 'not_linked'), false)
})

test('Drive on, no service account, link status not loaded: the page does not claim "local only"', () => {
  assert.equal(isBackupLocalOnly(form({ backup_drive_enabled: 'true' }), null), false)
})

// ─── The panel ────────────────────────────────────────────────────────────────
const PANEL = new URL('../app/components/admin/backup/BackupSettingsPanel.vue', import.meta.url).pathname
const panelState = (backupsLocalOnly: boolean, isSuperAdmin = true) => ({
  isSuperAdmin, settingsLoaded: true, settingsLoadError: '', loadSettings: () => {},
  backupSettings: {
    backup_auto_enabled: 'true', backup_auto_hour: '3', backup_auto_days: '[]', backup_keep_count: '14',
    backup_drive_enabled: 'false', backup_drive_service_account: '', backup_drive_folder_id: '',
  },
  selectedDays: [], daysOptions: [{ label: 'CN', value: 0 }], savingSettings: false, saveSettings: () => {},
  schedulerDisabledByServer: false, backupsLocalOnly,
  driveLink: null, driveRedirectUri: '', driveLinkLoading: false, disconnecting: false, driveToast: '',
  disconnectDrive: () => {}, copyRedirectUri: () => {},
  driveConfig: null, driveConfigLoading: false, savingDriveConfig: false, clearingDriveSecret: false,
  driveClientId: '', driveClientSecret: '', driveEnabled: false, saveDriveConfig: () => {}, clearDriveSecret: () => {},
  formatWhen: (value: string) => value,
})
const warningOf = (html: string) => /<p[^>]*data-testid="backup-offsite-missing"[^>]*>([\s\S]*?)<\/p>/.exec(html)
const text = (fragment: string) => fragment.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

test('the panel renders the warning: backups exist only on this server', async () => {
  const warning = warningOf(await renderSfcTemplate(PANEL, panelState(true)))
  assert.ok(warning, 'no warning rendered')
  const words = text(warning[1]!)
  assert.match(words, /chỉ nằm trên máy chủ/)
  assert.match(words, /Google Drive/)
  assert.match(warning[0], /<i [^>]*aria-hidden="true"/, 'the icon is decorative; the words carry the warning')
  // ui-dna: no implementation detail (env names, scripts, paths) in the page.
  assert.doesNotMatch(words, /BACKUP_|manage\.sh|crontab|\/app\/|offsite_status/)
  // Yellow = warning (ui-dna), the same notice style the scheduler notice uses.
  assert.match(warning[0], /border-\[#f0dcae\] bg-\[#fdf6e7\][^"]*text-\[#8a6412\]/)
})

test('the warning tells a SuperAdmin what to do, and anyone else whom to ask', async () => {
  assert.match(text(warningOf(await renderSfcTemplate(PANEL, panelState(true, true)))![1]!), /Bật .Upload lên Google Drive./)
  assert.match(text(warningOf(await renderSfcTemplate(PANEL, panelState(true, false)))![1]!), /quản trị viên cấp cao/)
})

test('no warning when the composable says Drive is configured', async () => {
  assert.equal(warningOf(await renderSfcTemplate(PANEL, panelState(false))), null)
})

test('the warning sits with the automatic-backup switch, next to the scheduler notice', () => {
  const template = parse(read('app/components/admin/backup/BackupSettingsPanel.vue')).descriptor.template?.content ?? ''
  const notice = template.indexOf('data-testid="backup-scheduler-disabled"')
  const warning = template.indexOf('data-testid="backup-offsite-missing"')
  const driveBlock = template.indexOf('<!-- Google Drive -->')
  assert.ok(notice > 0 && warning > notice && warning < driveBlock, 'the warning belongs to the "Tự động" block')
})

test('the composable computes the warning from the loaded form and link status, never before they are loaded', () => {
  const composable = read('app/composables/useBackupSettings.ts')
  assert.match(composable, /const backupsLocalOnly = computed\(\(\) => settingsLoaded\.value && !driveLinkLoading\.value\s*&& isBackupLocalOnly\(backupSettings\.value, driveLink\.value\?\.status \?\? null\)\)/)
  assert.match(composable, /return \{[\s\S]*\bbackupsLocalOnly\b[\s\S]*\}/)
  assert.match(read('app/components/admin/backup/BackupSettingsPanel.vue'), /\bbackupsLocalOnly\b[\s\S]*= useBackupSettings\(\)/)
})

// ─── The list ─────────────────────────────────────────────────────────────────
const row = (over: Partial<{ status: string, offsiteStatus: string | null, driveUploaded: boolean }>) => ({ status: 'done', offsiteStatus: null, driveUploaded: false, ...over })

test('each status reads as words', () => {
  assert.equal(offsiteStatusDisplay(row({ offsiteStatus: 'uploaded' }))?.label, 'Đã lên Drive')
  assert.equal(offsiteStatusDisplay(row({ offsiteStatus: 'failed' }))?.label, 'Lỗi tải lên Drive')
  assert.equal(offsiteStatusDisplay(row({ offsiteStatus: 'none' }))?.label, 'Chỉ trên máy chủ')
  const tones = new Set(['uploaded', 'failed', 'none'].map(status => offsiteStatusDisplay(row({ offsiteStatus: status }))?.className))
  assert.equal(tones.size, 3, 'the three states look different too')
})

test('rows from before the column fall back to drive_uploaded; a failed backup has no status', () => {
  assert.equal(offsiteStatusDisplay(row({ offsiteStatus: null, driveUploaded: true }))?.label, 'Đã lên Drive')
  assert.equal(offsiteStatusDisplay(row({ offsiteStatus: null, driveUploaded: false }))?.label, 'Chỉ trên máy chủ')
  assert.equal(offsiteStatusDisplay(row({ status: 'failed', offsiteStatus: null })), null)
})

const BADGE = new URL('../app/components/admin/backup/BackupOffsiteBadge.vue', import.meta.url).pathname
const badge = (item: ReturnType<typeof row>) => renderSfcTemplate(BADGE, { display: offsiteStatusDisplay(item) })

test('the badge renders the words of the status, with a decorative icon', async () => {
  const html = await badge(row({ offsiteStatus: 'failed' }))
  assert.match(html, /data-testid="backup-offsite-status"/)
  assert.equal(text(html), 'Lỗi tải lên Drive')
  assert.match(html, /<i class="fa-solid fa-triangle-exclamation" aria-hidden="true">/)
  assert.equal(text(await badge(row({ status: 'failed' }))), '—', 'a failed backup shows a dash, not a status')
  // The component computes its display through the same util the tests above pin.
  assert.match(read('app/components/admin/backup/BackupOffsiteBadge.vue'), /const display = computed\(\(\) => offsiteStatusDisplay\(props\.item\)\)/)
})

test('the list shows the badge in the table and in the phone cards, not an unlabelled icon', () => {
  const page = read('app/pages/admin/settings/backup.vue')
  assert.equal((page.match(/<BackupOffsiteBadge :item="item" \/>/g) ?? []).length, 2, 'table cell and phone card')
  assert.doesNotMatch(page, /<i v-if="item\.driveUploaded"/, 'the icon-only Drive cell is gone')
  assert.match(page, /offsiteStatus: OffsiteStatus \| null/)
  assert.match(page, /<th class="px-3\.5 py-3">Bản ngoài máy chủ<\/th>/)
})

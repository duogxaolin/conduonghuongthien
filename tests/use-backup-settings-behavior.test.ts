/**
 * `app/composables/useBackupSettings.ts` — the "Cài đặt backup" block of
 * /admin/settings/backup — run for real (wave3 7.1 batch A, D-FETCH): its seven requests
 * now go through `adminFetch<T>()` with response types derived from the handlers
 * (app/types/admin-backup-api.ts) instead of seven `$fetch` casts.
 *
 * REAL ofetch over a fake network (the `installNetwork` shape of
 * tests/admin-fetch-rollout.test.ts), the composable's own `adminFetch`, `errorMessage`
 * and `backupSettingsPayload`; only the Nuxt-runtime auto-imports it still uses —
 * `useToast`, `useConfirm`, `useAdminAuth`, `useRoute` — are stand-ins on `globalThis`
 * (node:test runs each file in its own process). What is checked is what the officer gets:
 *   1. what each action sends (method, path, body) and the reloads after it;
 *   2. a failure shows the sentence the SERVER wrote — 401 and 403 included, with no
 *      redirect and no second request (the block does not branch on the status) — and a
 *      dropped connection the block's own fallback, never ofetch's `[GET] "…"` line;
 *   3. a failed settings load blocks saving: the form still holds the defaults, and
 *      saving them would overwrite the real configuration (or be refused for an editor);
 *   4. confirm dialogs answered "no" send nothing.
 * Source-text contracts on this file stay in tests/backup-settings-ui.test.ts,
 * backup-offsite-ui and backup-scheduler-notice-ui.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { formatWhen } from '../app/utils/backup-format.ts'
import { findAll, mountSfc, textOf } from './_sfc-mount.ts'

// ─── Fake network under real ofetch ──────────────────────────────────────────

type NetCall = { method: string, url: URL, body: unknown }
type Responder = (call: NetCall) => Response | Error | undefined

function installNetwork(responder: Responder) {
  const calls: NetCall[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://admin.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    }
    calls.push(call)
    const answer = responder(call)
    if (answer instanceof Error) reject(answer)
    else resolve(answer ?? json({ statusCode: 404, statusMessage: 'Not Found' }, 404))
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return calls
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden' }
const json = (body: unknown, status = 200, statusText = STATUS_TEXT[status] ?? '') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } })
/** `createError({ statusCode, statusMessage })` from a Nitro handler; h3 strips non-ASCII from the status line. */
const h3Error = (statusCode: number, statusMessage: string) =>
  json({ statusCode, statusMessage, message: statusMessage }, statusCode, statusMessage.replace(/[^\t\x20-\x7E]/g, ''))
const dropped = () => new TypeError('fetch failed')
const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

// ─── The Nuxt runtime auto-imports, installed before the composable loads ────

type Toast = { type: string, message: string }
const toasts: Toast[] = []
const confirms: string[] = []
let confirmAnswer = true
let superAdmin = true
let routeQuery: Record<string, unknown> = {}

Object.assign(globalThis, {
  useToast: () => Object.fromEntries(['success', 'error', 'warning', 'info'].map(type =>
    [type, (message: string) => { toasts.push({ type, message }) }])),
  useConfirm: () => ({ confirm: async (options: { title: string }) => { confirms.push(options.title); return confirmAnswer } }),
  useAdminAuth: () => ({ user: Vue.ref({ isSuperAdmin: superAdmin }) }),
  useRoute: () => ({ query: routeQuery }),
})

const { useBackupSettings } = await import('../app/composables/useBackupSettings.ts')

beforeEach(() => {
  toasts.length = 0
  confirms.length = 0
  confirmAnswer = true
  superAdmin = true
  routeQuery = {}
})

const lastToast = (type: string) => toasts.filter(t => t.type === type).at(-1)?.message

// ─── The backup settings API, as the handlers answer it ──────────────────────

const STORED = {
  backup_auto_enabled: 'true', backup_auto_hour: '2', backup_auto_days: '[1,3]', backup_keep_count: '7',
  backup_drive_enabled: 'true', backup_drive_service_account: '********', backup_drive_folder_id: 'folder-1',
}
const LINK = { linked: true, linkedEmail: 'c11@example.vn', linkedSub: '1234', linkedAt: '2026-10-20T02:00:00.000Z', status: 'linked' }
const CONFIG = {
  clientId: 'drive-client.apps.googleusercontent.com', hasClientSecret: true, clientSecretMasked: '••••wxyz',
  clientSecretStatus: 'configured', isEnabled: true, redirectUri: 'https://cdht.example.vn/api/admin/backup/drive/callback',
  redirectUriSource: 'request', publicBaseUrl: '', missing: [], updatedAt: '2026-10-20T02:00:00.000Z',
}

function backupServer(override: Responder = () => undefined): Responder {
  return (call) => {
    const answer = override(call)
    if (answer) return answer
    const route = `${call.method} ${call.url.pathname}`
    if (route === 'GET /api/admin/settings/backup') {
      return json({ ok: true, settings: STORED, needsReentry: ['backup_drive_service_account'], schedulerDisabledByServer: true })
    }
    if (route === 'PUT /api/admin/settings/backup') return json({ ok: true })
    if (route === 'GET /api/admin/backup/drive/status') return json({ ok: true, link: LINK, redirectUri: 'https://status.example.vn/cb' })
    if (route === 'GET /api/admin/backup/drive/config') return json({ ok: true, config: CONFIG })
    if (route === 'PUT /api/admin/backup/drive/config') {
      const body = call.body as { clientId: string, isEnabled: boolean }
      return json({ ok: true, config: { ...CONFIG, clientId: body.clientId, isEnabled: body.isEnabled } })
    }
    if (route === 'POST /api/admin/backup/drive/clear-secret') {
      return json({ ok: true, config: { ...CONFIG, hasClientSecret: false, clientSecretMasked: null, clientSecretStatus: 'not_configured', isEnabled: false } })
    }
    if (route === 'POST /api/admin/backup/drive/disconnect') return json({ ok: true })
    return undefined
  }
}

async function loaded(override?: Responder) {
  const calls = installNetwork(backupServer(override))
  const block = useBackupSettings()
  block.loadAll()
  await settle()
  return { block, calls }
}

// ─── Loading ─────────────────────────────────────────────────────────────────

describe('useBackupSettings — loading', () => {
  it('loadAll reads the settings, the Drive link and the Drive OAuth config — three GETs, nothing else', async () => {
    const { block, calls } = await loaded()
    assert.deepEqual(calls.map(wire), [
      'GET /api/admin/settings/backup',
      'GET /api/admin/backup/drive/status',
      'GET /api/admin/backup/drive/config',
    ])
    assert.equal(block.settingsLoaded.value, true)
    assert.equal(block.settingsLoadError.value, '')
    assert.deepEqual(block.backupSettings.value, STORED)
    assert.deepEqual(block.selectedDays.value, [1, 3])
    assert.equal(block.schedulerDisabledByServer.value, true)
    assert.equal(block.serviceAccountNeedsReentry.value, true)
    assert.deepEqual(block.driveLink.value, LINK)
    // The config answer's redirect URI wins over the status answer's (same source on the server).
    assert.equal(block.driveRedirectUri.value, CONFIG.redirectUri)
    assert.equal(block.driveClientId.value, CONFIG.clientId)
    assert.equal(block.driveEnabled.value, true)
    assert.equal(block.driveClientSecret.value, '')
    assert.equal(block.backupsLocalOnly.value, false, 'Drive on and linked: not local-only')
  })

  it('missing settings fall back to the form defaults, never to undefined', async () => {
    const { block } = await loaded((call) => call.url.pathname === '/api/admin/settings/backup'
      ? json({ ok: true, settings: { backup_auto_enabled: null }, needsReentry: [], schedulerDisabledByServer: false })
      : undefined)
    assert.deepEqual(block.backupSettings.value, {
      backup_auto_enabled: 'false', backup_auto_hour: '3', backup_auto_days: '[]', backup_keep_count: '14',
      backup_drive_enabled: 'false', backup_drive_service_account: '', backup_drive_folder_id: '',
    })
    assert.equal(block.serviceAccountNeedsReentry.value, false)
  })

  for (const [status, sentence] of [[403, 'Forbidden: Insufficient permissions'], [401, 'Phiên đăng nhập đã hết hạn.']] as const) {
    it(`a ${status} on the settings load shows the server's sentence and blocks saving — no redirect, no second request`, async () => {
      const { block, calls } = await loaded((call) => call.url.pathname === '/api/admin/settings/backup' ? h3Error(status, sentence) : undefined)
      assert.equal(block.settingsLoadError.value, sentence)
      assert.equal(block.settingsLoaded.value, false)
      assert.equal(calls.filter(c => c.url.pathname === '/api/admin/settings/backup').length, 1, 'no retry, no re-ask')

      await block.saveSettings()
      assert.ok(!calls.some(c => c.method === 'PUT'), 'the defaults still in the form are never sent')
      assert.equal(toasts.length, 0)
    })
  }

  it('a dropped connection shows the block\'s own sentence, never ofetch\'s request line', async () => {
    const { block } = await loaded((call) => call.url.pathname === '/api/admin/settings/backup' ? dropped() : undefined)
    assert.equal(block.settingsLoadError.value, 'Không tải được cấu hình backup.')
    assert.doesNotMatch(block.settingsLoadError.value, /\[GET\]|fetch failed/)
  })

  it('retrying after a failed load (the panel\'s "Thử lại") clears the error and unblocks saving', async () => {
    let fail = true
    const { block, calls } = await loaded((call) => call.url.pathname === '/api/admin/settings/backup' && fail ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    fail = false
    await block.loadSettings()
    assert.equal(block.settingsLoadError.value, '')
    assert.equal(block.settingsLoaded.value, true)
    await block.saveSettings()
    assert.equal(calls.at(-1)?.method, 'PUT')
  })

  // What the panel shows for it — to every officer — is pinned by the panel tests below.
  it('a failed Drive link load sets driveToast to the server\'s sentence', async () => {
    const { block } = await loaded((call) => call.url.pathname === '/api/admin/backup/drive/status' ? h3Error(403, 'Không có quyền xem liên kết Drive.') : undefined)
    assert.equal(block.driveToast.value, 'Không có quyền xem liên kết Drive.')
    assert.equal(block.driveLinkLoading.value, false)
    assert.equal(block.backupsLocalOnly.value, false, 'Drive on: whatever the link, not local-only')
  })

  it('a failed Drive config load toasts the server\'s sentence', async () => {
    await loaded((call) => call.url.pathname === '/api/admin/backup/drive/config' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    assert.equal(lastToast('error'), 'Forbidden: Insufficient permissions')
  })

  it('the OAuth callback\'s query reads as a sentence', async () => {
    routeQuery = { drive_linked: '1' }
    await loaded()
    assert.equal(lastToast('success'), 'Đã liên kết Google Drive thành công.')

    routeQuery = { drive_error: 'declined' }
    await loaded()
    assert.equal(lastToast('error'), 'Bạn đã từ chối consent Google.')

    routeQuery = { drive_error: 'weird' }
    await loaded()
    assert.equal(lastToast('error'), 'Liên kết Drive thất bại (weird).')
  })
})

// ─── Saving the schedule ─────────────────────────────────────────────────────

describe('useBackupSettings — saving', () => {
  it('a SuperAdmin saves the whole form, with the ticked days', async () => {
    const { block, calls } = await loaded()
    block.selectedDays.value = [0, 6]
    block.backupSettings.value.backup_auto_hour = '5'
    await block.saveSettings()
    const put = calls.at(-1)!
    assert.equal(wire(put), 'PUT /api/admin/settings/backup')
    assert.deepEqual(put.body, { ...STORED, backup_auto_hour: '5', backup_auto_days: '[0,6]' })
    assert.equal(lastToast('success'), 'Đã lưu cấu hình backup.')
    assert.equal(block.savingSettings.value, false)
  })

  it('an editor never sends the SuperAdmin-only keys (Drive destination, keep count)', async () => {
    superAdmin = false
    const { block, calls } = await loaded()
    await block.saveSettings()
    assert.deepEqual(calls.at(-1)!.body, {
      backup_auto_enabled: 'true', backup_auto_hour: '2', backup_auto_days: '[1,3]',
    })
  })

  for (const [status, sentence] of [[400, 'Giờ backup không hợp lệ (0-23).'], [403, 'Chỉ quản trị viên cấp cao được đổi đích backup.'], [401, 'Phiên đăng nhập đã hết hạn.']] as const) {
    it(`a ${status} on save toasts the server's sentence, and nothing else happens`, async () => {
      const { block, calls } = await loaded((call) => call.method === 'PUT' ? h3Error(status, sentence) : undefined)
      const before = calls.length
      await block.saveSettings()
      assert.equal(calls.length, before + 1, 'one PUT, no retry, no reload')
      assert.equal(lastToast('error'), sentence)
      assert.equal(block.savingSettings.value, false)
    })
  }

  it('a dropped save toasts the block\'s own sentence', async () => {
    const { block } = await loaded((call) => call.method === 'PUT' ? dropped() : undefined)
    await block.saveSettings()
    assert.equal(lastToast('error'), 'Lỗi lưu cấu hình')
  })
})

// ─── Drive OAuth credentials, link ───────────────────────────────────────────

describe('useBackupSettings — Drive', () => {
  it('saving the OAuth config without a new secret keeps the stored one (the key is not sent)', async () => {
    const { block, calls } = await loaded()
    block.driveClientId.value = '  new-client.apps.googleusercontent.com  '
    block.driveEnabled.value = false
    await block.saveDriveConfig()
    const put = calls.at(-1)!
    assert.equal(wire(put), 'PUT /api/admin/backup/drive/config')
    assert.deepEqual(put.body, { clientId: 'new-client.apps.googleusercontent.com', isEnabled: false })
    // The answer is the new state of the form.
    assert.equal(block.driveConfig.value?.clientId, 'new-client.apps.googleusercontent.com')
    assert.equal(block.driveClientId.value, 'new-client.apps.googleusercontent.com')
    assert.equal(block.driveEnabled.value, false)
    assert.equal(lastToast('success'), 'Đã lưu cấu hình OAuth Drive.')
  })

  it('a typed secret is sent trimmed, then the field is emptied', async () => {
    const { block, calls } = await loaded()
    block.driveClientSecret.value = '  GOCSPX-secret  '
    await block.saveDriveConfig()
    assert.deepEqual(calls.at(-1)!.body, { clientId: CONFIG.clientId, isEnabled: true, clientSecret: 'GOCSPX-secret' })
    assert.equal(block.driveClientSecret.value, '')
  })

  it('a refused OAuth config save toasts the server\'s sentence and keeps what was typed', async () => {
    const { block } = await loaded((call) => call.method === 'PUT' ? h3Error(400, 'Client ID không được chứa khoảng trắng.') : undefined)
    block.driveClientSecret.value = 'typed'
    await block.saveDriveConfig()
    assert.equal(lastToast('error'), 'Client ID không được chứa khoảng trắng.')
    assert.equal(block.driveClientSecret.value, 'typed')
    assert.equal(block.savingDriveConfig.value, false)
  })

  it('removing the secret: "no" sends nothing; "yes" posts and shows OAuth off', async () => {
    confirmAnswer = false
    const { block, calls } = await loaded()
    const before = calls.length
    await block.clearDriveSecret()
    assert.equal(calls.length, before)
    assert.deepEqual(confirms, ['Gỡ client secret Drive'])

    confirmAnswer = true
    await block.clearDriveSecret()
    assert.equal(wire(calls.at(-1)!), 'POST /api/admin/backup/drive/clear-secret')
    assert.equal(block.driveConfig.value?.clientSecretStatus, 'not_configured')
    assert.equal(block.driveEnabled.value, false)
    assert.equal(lastToast('success'), 'Đã gỡ client secret Drive.')
  })

  it('unlinking: "no" sends nothing; "yes" posts, then re-reads the link status', async () => {
    confirmAnswer = false
    const { block, calls } = await loaded()
    const before = calls.length
    await block.disconnectDrive()
    assert.equal(calls.length, before)

    confirmAnswer = true
    await block.disconnectDrive()
    assert.deepEqual(calls.slice(before).map(wire), ['POST /api/admin/backup/drive/disconnect', 'GET /api/admin/backup/drive/status'])
    assert.equal(lastToast('success'), 'Đã hủy liên kết Google Drive.')
    assert.equal(block.disconnecting.value, false)
  })

  it('a refused unlink toasts the server\'s sentence and does not re-read', async () => {
    const { block, calls } = await loaded((call) => call.url.pathname.endsWith('/disconnect') ? h3Error(403, 'Chỉ quản trị viên cấp cao được hủy liên kết.') : undefined)
    const before = calls.length
    await block.disconnectDrive()
    assert.equal(calls.length, before + 1)
    assert.equal(lastToast('error'), 'Chỉ quản trị viên cấp cao được hủy liên kết.')
  })

  it('FINDING: a link re-read that fails forgets the old link — unknown, not a stale "linked" (RED on base)', async () => {
    let failStatus = false
    const { block } = await loaded((call) => call.url.pathname === '/api/admin/backup/drive/status' && failStatus ? h3Error(503, 'Tạm thời không đọc được liên kết Drive.') : undefined)
    assert.deepEqual(block.driveLink.value, LINK)
    failStatus = true
    await block.disconnectDrive()
    await settle()
    assert.equal(block.driveLink.value, null)
    assert.equal(block.driveToast.value, 'Tạm thời không đọc được liên kết Drive.')
  })

  it('FINDING: the next Drive link load clears the previous failure (RED on base)', async () => {
    let failStatus = true
    const { block } = await loaded((call) => call.url.pathname === '/api/admin/backup/drive/status' && failStatus ? h3Error(403, 'Không có quyền xem liên kết Drive.') : undefined)
    assert.equal(block.driveToast.value, 'Không có quyền xem liên kết Drive.')
    failStatus = false
    block.loadAll()
    await settle()
    assert.deepEqual(block.driveLink.value, LINK)
    assert.equal(block.driveToast.value, '')
  })
})

// ─── What the panel shows about the Drive link ───────────────────────────────

/**
 * `components/admin/backup/BackupSettingsPanel.vue` mounted for real (tests/_sfc-mount.ts)
 * on the real composable. The link block is a `v-if` chain; a failed status read used to
 * show its sentence only inside ONE branch (SuperAdmin, OAuth on) while everyone else read
 * a claim the page could not make: "Chưa liên kết tài khoản Google Drive." for an officer
 * whose status read had failed, "Cần nhập Client ID…" for a SuperAdmin with OAuth off.
 */
describe('BackupSettingsPanel — Drive link status', () => {
  const PANEL_FILE = new URL('../app/components/admin/backup/BackupSettingsPanel.vue', import.meta.url).pathname
  const NOT_LINKED = { linked: false, linkedEmail: null, linkedSub: null, linkedAt: null, status: 'not_linked' }

  async function panel(override?: Responder) {
    const calls = installNetwork(backupServer(override))
    const mounted = await mountSfc(PANEL_FILE, { auto: { useBackupSettings, formatWhen, onMounted: Vue.onMounted } })
    await settle()
    const alerts = () => findAll(mounted.root, el => el.props.role === 'alert').map(textOf)
    return { mounted, calls, alerts, text: () => textOf(mounted.root) }
  }
  const statusFails = (call: { url: URL }) => (call.url.pathname === '/api/admin/backup/drive/status' ? h3Error(403, 'Không có quyền xem liên kết Drive.') : undefined)

  it('FINDING: an officer whose status read failed sees the server\'s sentence, not "Chưa liên kết" (RED on base)', async () => {
    superAdmin = false
    const { mounted, alerts, text } = await panel(statusFails)
    assert.deepEqual(alerts(), ['Không có quyền xem liên kết Drive.'])
    assert.doesNotMatch(text(), /Chưa liên kết tài khoản Google Drive/)
    mounted.unmount()
  })

  it('FINDING: a SuperAdmin with OAuth off sees the failure too, and no "Cần nhập Client ID…" claim (RED on base)', async () => {
    const { mounted, alerts, text } = await panel(call => statusFails(call)
      ?? (call.url.pathname === '/api/admin/backup/drive/config' ? json({ ok: true, config: { ...CONFIG, isEnabled: false } }) : undefined))
    assert.deepEqual(alerts(), ['Không có quyền xem liên kết Drive.'])
    assert.doesNotMatch(text(), /Cần nhập Client ID/)
    assert.doesNotMatch(text(), /Liên kết Google Drive$/m)
    mounted.unmount()
  })

  it('FINDING: a SuperAdmin with OAuth on whose status read failed gets the sentence, and no "Liên kết" button while the link is unknown (RED on base)', async () => {
    const { mounted, alerts } = await panel(statusFails)
    assert.deepEqual(alerts(), ['Không có quyền xem liên kết Drive.'])
    assert.equal(findAll(mounted.root, el => el.tag === 'a' && el.props.href === '/api/admin/backup/drive/start').length, 0)
    mounted.unmount()
  })

  it('not linked: the link button for a SuperAdmin with OAuth on, "Chưa liên kết" for anyone else, no alert', async () => {
    const notLinked = (call: { url: URL }) => (call.url.pathname === '/api/admin/backup/drive/status' ? json({ ok: true, link: NOT_LINKED, redirectUri: 'https://x/cb' }) : undefined)
    const admin = await panel(notLinked)
    assert.equal(findAll(admin.mounted.root, el => el.tag === 'a' && el.props.href === '/api/admin/backup/drive/start').length, 1)
    assert.deepEqual(admin.alerts(), [])
    admin.mounted.unmount()

    superAdmin = false
    const officer = await panel(notLinked)
    assert.match(officer.text(), /Chưa liên kết tài khoản Google Drive\./)
    assert.deepEqual(officer.alerts(), [])
    officer.mounted.unmount()
  })

  it('linked: the account and when it was linked', async () => {
    const { mounted, text, alerts } = await panel()
    assert.ok(text().includes(`Đã liên kết: c11@example.vn — ${formatWhen(LINK.linkedAt)}`), text())
    assert.deepEqual(alerts(), [])
    mounted.unmount()
  })
})

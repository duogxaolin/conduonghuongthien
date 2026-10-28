/**
 * Wave 3 D-FETCH, batch C: the eight settings pages batch A left — pages/admin/settings/
 * {email,tracking,media-storage,google-oauth,ip-bans,security,sitemap,data-retention}.vue
 * (22 `$fetch` casts) — call `adminFetch<T>()` with response types derived from the
 * handlers (app/types/admin-settings-api.ts).
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network. Pinned, green before and after the conversion:
 *   - the exact requests of the mount and of every action (method, path, query, body) and
 *     the reloads after them — the conversion is a no-op on the wire;
 *   - what the officer reads back: loaded values in the form, the nullable cells;
 *   - a failed load is a `role="alert"` block with the sentence the SERVER wrote and a retry
 *     that asks again; a dropped connection shows the page's own fallback; a failed action
 *     toasts the server's sentence — never ofetch's `[GET] "…"` line;
 *   - an `ok: false` answer is the page's fallback, not an empty form.
 *
 * The sitemap's "Lần lưu cuối" is pinned on the server side, where the bug was:
 * tests/admin-sitemap-updated-at-behavior.test.ts.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, buttons, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type MountOptions, type NetCall,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}
const inputs = (opened: MountedAdminPage, match: (el: MiniElement) => boolean) =>
  findAll(opened.page.root, el => (el.tag === 'input' || el.tag === 'select' || el.tag === 'textarea') && match(el))
const field = (opened: MountedAdminPage, match: (el: MiniElement) => boolean) => {
  const found = inputs(opened, match)
  assert.equal(found.length, 1, `expected one field, found ${found.length}`)
  return found[0]!
}
const byPlaceholder = (opened: MountedAdminPage, placeholder: string) => field(opened, el => el.props.placeholder === placeholder)
const modelOf = (el: MiniElement) => el.model?.value

/**
 * Load fails with the server's sentence → a `role="alert"` block with it; its retry asks
 * the same URL again and, answered, shows the page. A dropped connection → the fallback.
 */
async function assertLoadFailureContract(page: string, url: string, fallback: string, good: () => Response, retryLabel: string, extra: Record<string, Route> = {}, options: MountOptions = {}) {
  let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem cài đặt này.')
  const opened = await mountAdminPage(page, routes({ [`GET ${url}`]: () => answer(), ...extra }), options)
  assert.match(alertText(opened.page), /Bạn không có quyền xem cài đặt này\./)
  assertOnlyServerSentences(opened)
  answer = good
  const before = opened.calls.length
  await click(byText(opened.page.root, 'button', retryLabel))
  await settle()
  assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${url}`], 'the retry asks the same URL again')
  assert.equal(alertText(opened.page), '', 'answered, the alert is gone')

  const offline = await mountAdminPage(page, routes({ [`GET ${url}`]: () => dropped(), ...extra }), options)
  assert.match(alertText(offline.page), new RegExp(fallback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assertOnlyServerSentences(offline)
}

// ─── /api/admin/settings pages ───────────────────────────────────────────────

const SMTP = {
  smtp_host: 'smtp.example.vn', smtp_port: '465', smtp_secure: 'true', smtp_user: 'cdkt@example.vn', smtp_pass: '********', smtp_from: null,
}
const settingsAnswer = (settings: Record<string, string | null>, needsReentry: string[] = []) => json({ ok: true, settings, needsReentry })

describe('pages/admin/settings/email.vue', () => {
  const PAGE = 'pages/admin/settings/email.vue'
  const server = (overrides: Record<string, Route> = {}) => routes({
    'GET /api/admin/settings': () => settingsAnswer(SMTP),
    'PUT /api/admin/settings': () => json({ ok: true }),
    'POST /api/admin/settings/test-email': () => json({ ok: true, message: 'Đã gửi email thử tới a@b.vn. Vui lòng kiểm tra hộp thư.' }),
    ...overrides,
  })

  it('mount: one GET; the stored values fill the form, a NULL key keeps the field empty', async () => {
    const opened = await mountAdminPage(PAGE, server())
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/settings'])
    assert.equal(modelOf(byPlaceholder(opened, 'smtp.gmail.com')), 'smtp.example.vn')
    assert.equal(modelOf(field(opened, el => el.props.id === 'smtp-port')), '465')
    assert.equal(modelOf(field(opened, el => el.props.id === 'smtp-pass')), '********')
    assert.equal(modelOf(byPlaceholder(opened, 'Con Đường Hướng Thiện <no-reply@domain.vn>')), '')
  })

  it('save: PUTs the six keys as the form holds them, toasts, reloads', async () => {
    const opened = await mountAdminPage(PAGE, server())
    await input(byPlaceholder(opened, 'Con Đường Hướng Thiện <no-reply@domain.vn>'), 'CDKT <no-reply@example.vn>')
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lưu Cấu Hình'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/settings', body: { settings: { ...SMTP, smtp_from: 'CDKT <no-reply@example.vn>' } } },
      'GET /api/admin/settings',
    ])
    assert.equal(opened.lastToast('success'), 'Đã lưu cấu hình email SMTP!')
  })

  it('save refused: the server\'s sentence, no reload', async () => {
    const opened = await mountAdminPage(PAGE, server({ 'PUT /api/admin/settings': () => h3Error(400, 'Giá trị cài đặt "smtp_host" quá dài.') }))
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lưu Cấu Hình'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/settings'])
    assert.equal(opened.lastToast('error'), 'Giá trị cài đặt "smtp_host" quá dài.')
    assertOnlyServerSentences(opened)
  })

  it('test send: POSTs the form plus `to`, toasts the server\'s message; a refusal toasts its sentence', async () => {
    const opened = await mountAdminPage(PAGE, server())
    await input(byPlaceholder(opened, 'test@example.com'), '  a@b.vn ')
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Gửi thử'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'POST /api/admin/settings/test-email', body: { ...SMTP, smtp_from: '', to: 'a@b.vn' } }])
    assert.equal(opened.lastToast('success'), 'Đã gửi email thử tới a@b.vn. Vui lòng kiểm tra hộp thư.')

    const refused = await mountAdminPage(PAGE, server({ 'POST /api/admin/settings/test-email': () => h3Error(400, 'Gửi email thử thất bại: máy chủ từ chối đăng nhập.') }))
    await input(byPlaceholder(refused, 'test@example.com'), 'a@b.vn')
    await click(byText(refused.page.root, 'button', 'Gửi thử'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Gửi email thử thất bại: máy chủ từ chối đăng nhập.')
    assertOnlyServerSentences(refused)
  })

  it('a stored password the current key cannot open is named under the field', async () => {
    const opened = await mountAdminPage(PAGE, server({ 'GET /api/admin/settings': () => settingsAnswer(SMTP, ['smtp_pass']) }))
    assert.match(textOf(field(opened, el => el.props.id === 'smtp-pass').parent!), /Mật khẩu đã lưu không giải mã được/)
  })

  it('load failure / retry / dropped connection / `ok: false`', async () => {
    await assertLoadFailureContract(PAGE, '/api/admin/settings', 'Không tải được cài đặt email.', () => settingsAnswer(SMTP), 'thử lại')
    const notOk = await mountAdminPage(PAGE, routes({ 'GET /api/admin/settings': () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được cài đặt email\./)
  })
})

const TRACKING = {
  tracking_enabled: '1', ga4_measurement_id: 'G-ABC123', gtm_container_id: null, google_ads_id: '', google_ads_conversion_label: '',
  google_site_verification: '', facebook_pixel_id: '', tiktok_pixel_id: '', clarity_project_id: '', tracking_custom_head: '', tracking_custom_body: '',
}

describe('pages/admin/settings/tracking.vue', () => {
  const PAGE = 'pages/admin/settings/tracking.vue'
  const server = (overrides: Record<string, Route> = {}) => routes({
    'GET /api/admin/settings': () => settingsAnswer(TRACKING),
    'PUT /api/admin/settings': () => json({ ok: true }),
    ...overrides,
  })

  it('mount + save: one GET; the save PUTs the eleven keys (NULL read as empty) and does not reload', async () => {
    const opened = await mountAdminPage(PAGE, server())
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/settings'])
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lưu Cấu Hình'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'PUT /api/admin/settings', body: { settings: { ...TRACKING, gtm_container_id: '' } } }])
    assert.equal(opened.lastToast('success'), 'Đã lưu cấu hình Tracking & Marketing!')
  })

  it('save refused (SuperAdmin-only custom code): the server\'s sentence', async () => {
    const sentence = 'Chỉ SuperAdmin mới được thay đổi mã tuỳ chỉnh (Custom head/body) vì mã này chạy trên toàn bộ trang công khai.'
    const opened = await mountAdminPage(PAGE, server({ 'PUT /api/admin/settings': () => h3Error(403, sentence) }))
    await click(byText(opened.page.root, 'button', 'Lưu Cấu Hình'))
    await settle()
    assert.equal(opened.lastToast('error'), sentence)
    assertOnlyServerSentences(opened)
  })

  it('load failure / retry / dropped connection / `ok: false`', async () => {
    await assertLoadFailureContract(PAGE, '/api/admin/settings', 'Không tải được cấu hình theo dõi.', () => settingsAnswer(TRACKING), 'thử lại')
    const notOk = await mountAdminPage(PAGE, routes({ 'GET /api/admin/settings': () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được cấu hình theo dõi\./)
  })
})

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const MEDIA = { media_provider: 'r2', r2_account_id: ACCOUNT, r2_access_key: 'AK1', r2_secret_key: '********', r2_bucket: 'cdkt-uploads', r2_public_url: null }

describe('pages/admin/settings/media-storage.vue', () => {
  const PAGE = 'pages/admin/settings/media-storage.vue'
  const server = (overrides: Record<string, Route> = {}) => routes({
    // The general settings answer carries other pages' keys too; only the media ones are sent back.
    'GET /api/admin/settings': () => settingsAnswer({ ...MEDIA, smtp_host: 'smtp.example.vn', site_name: 'CDKT' }),
    'PUT /api/admin/settings': () => json({ ok: true }),
    'POST /api/admin/settings/test-r2': () => json({ ok: true, usedSaved: true, message: 'Kết nối Cloudflare R2 thành công! (dùng Secret Key đã lưu)' }),
    ...overrides,
  })

  it('save: PUTs only the six media keys (NULL read as empty), toasts, reloads', async () => {
    const opened = await mountAdminPage(PAGE, server())
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/settings'])
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lưu Cấu Hình'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/settings', body: { settings: { ...MEDIA, r2_public_url: '' } } },
      'GET /api/admin/settings',
    ])
    assert.equal(opened.lastToast('success'), 'Đã lưu cấu hình lưu trữ Media thành công!')
  })

  it('R2 test: POSTs the four credentials; success is a status line, a refusal an alert with the server\'s sentence', async () => {
    const opened = await mountAdminPage(PAGE, server())
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Kiểm Tra Kết Nối R2'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{
      wire: 'POST /api/admin/settings/test-r2',
      body: { accountId: ACCOUNT, accessKeyId: 'AK1', secretAccessKey: '********', bucket: 'cdkt-uploads' },
    }])
    assert.equal(opened.lastToast('success'), 'Kết nối Cloudflare R2 thành công! (dùng Secret Key đã lưu)')
    assert.match(textOf(findAll(opened.page.root, el => el.props.role === 'status')[0]!), /🎉 Kết nối Cloudflare R2 thành công!/)

    const refused = await mountAdminPage(PAGE, server({ 'POST /api/admin/settings/test-r2': () => h3Error(400, 'Kết nối R2 thất bại: sai Access Key.') }))
    await click(byText(refused.page.root, 'button', 'Kiểm Tra Kết Nối R2'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Kết nối R2 thất bại: sai Access Key.')
    assert.match(alertText(refused.page), /❌ Kết nối R2 thất bại: sai Access Key\./)
    assertOnlyServerSentences(refused)
  })

  it('a stored secret the current key cannot open is named under the field', async () => {
    const opened = await mountAdminPage(PAGE, server({ 'GET /api/admin/settings': () => settingsAnswer(MEDIA, ['r2_secret_key']) }))
    assert.match(textOf(opened.page.root), /Secret Key đã lưu không giải mã được/)
  })

  it('load failure / retry / dropped connection / `ok: false`', async () => {
    await assertLoadFailureContract(PAGE, '/api/admin/settings', 'Không tải được cấu hình lưu trữ.', () => settingsAnswer(MEDIA), 'thử lại')
    const notOk = await mountAdminPage(PAGE, routes({ 'GET /api/admin/settings': () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được cấu hình lưu trữ\./)
  })
})

// ─── Google sign-in ──────────────────────────────────────────────────────────

const OAUTH = {
  clientId: 'abc.apps.googleusercontent.com', hasClientSecret: true, clientSecretMasked: '••••wxyz', clientSecretStatus: 'configured',
  isEnabled: false, defaultCommentsEnabled: true, redirectUri: 'https://cdkt.example.vn/api/auth/google/callback',
  redirectUriSource: 'request', publicBaseUrl: '', missing: ['enabled'], updatedAt: null,
}

describe('pages/admin/settings/google-oauth.vue', () => {
  const PAGE = 'pages/admin/settings/google-oauth.vue'
  const URL_ = '/api/admin/settings/google-oauth'
  const server = (overrides: Record<string, Route> = {}) => routes({
    [`GET ${URL_}`]: () => json({ ok: true, settings: OAUTH }),
    [`PATCH ${URL_}`]: call => json({ ok: true, settings: { ...OAUTH, ...(call.body as object), clientSecretMasked: '••••9999', missing: [] } }),
    [`POST ${URL_}/clear-secret`]: () => json({ ok: true, settings: { ...OAUTH, hasClientSecret: false, clientSecretMasked: null, clientSecretStatus: 'not_configured', isEnabled: false, missing: ['clientSecret', 'enabled'] } }),
    ...overrides,
  })

  it('mount: the derived redirect URI, the masked secret and the missing steps', async () => {
    const opened = await mountAdminPage(PAGE, server())
    assert.deepEqual(opened.calls.map(wire), [`GET ${URL_}`])
    const screen = textOf(opened.page.root)
    assert.match(screen, /https:\/\/cdkt\.example\.vn\/api\/auth\/google\/callback/)
    assert.match(screen, /Đang cấu hình ••••wxyz/)
    assert.match(screen, /Công tắc đăng nhập Google đang tắt\./)
    assert.equal(modelOf(byPlaceholder(opened, '123456789-abcdef.apps.googleusercontent.com')), 'abc.apps.googleusercontent.com')
  })

  it('save: PATCHes the three fields (the secret only when typed); the answer replaces the shown state', async () => {
    const opened = await mountAdminPage(PAGE, server())
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: `PATCH ${URL_}`, body: { clientId: 'abc.apps.googleusercontent.com', isEnabled: false, defaultCommentsEnabled: true } }])
    assert.equal(opened.lastToast('success'), 'Đã lưu cấu hình đăng nhập Google.')

    await input(byPlaceholder(opened, 'Nhập secret mới khi cần thay thế'), '  NEW-SECRET-9999 ')
    const second = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.deepEqual(sent(opened.calls, second), [{ wire: `PATCH ${URL_}`, body: { clientId: 'abc.apps.googleusercontent.com', isEnabled: false, defaultCommentsEnabled: true, clientSecret: 'NEW-SECRET-9999' } }])
    assert.match(textOf(opened.page.root), /Đang cấu hình ••••9999/)
    assert.equal(modelOf(byPlaceholder(opened, 'Nhập secret mới khi cần thay thế')), '', 'the typed secret is cleared after the save')
  })

  it('save refused: the server\'s sentence', async () => {
    const opened = await mountAdminPage(PAGE, server({ [`PATCH ${URL_}`]: () => h3Error(400, 'Client ID không hợp lệ.') }))
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.equal(opened.lastToast('error'), 'Client ID không hợp lệ.')
    assertOnlyServerSentences(opened)
  })

  it('clear secret: confirmed → POST clear-secret, the switch follows the answer; declined → nothing sent', async () => {
    const opened = await mountAdminPage(PAGE, server())
    opened.answers.confirm = false
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Xoá Client secret'))
    await settle()
    assert.equal(opened.calls.length, before)
    opened.answers.confirm = true
    await click(byText(opened.page.root, 'button', 'Xoá Client secret'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`POST ${URL_}/clear-secret`])
    assert.equal(opened.confirms.at(-1)?.confirmLabel, 'Xoá secret')
    assert.equal(opened.lastToast('success'), 'Đã xoá Client secret.')
    assert.match(textOf(opened.page.root), /Chưa cấu hình\. Để trống để giữ nguyên\./)

    const refused = await mountAdminPage(PAGE, server({ [`POST ${URL_}/clear-secret`]: () => h3Error(403, 'Bạn không có quyền sửa cài đặt.') }))
    await click(byText(refused.page.root, 'button', 'Xoá Client secret'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Bạn không có quyền sửa cài đặt.')
  })

  it('load failure / retry / dropped connection / `ok: false`', async () => {
    await assertLoadFailureContract(PAGE, URL_, 'Không tải được cấu hình đăng nhập Google.', () => json({ ok: true, settings: OAUTH }), 'Thử lại')
    const notOk = await mountAdminPage(PAGE, routes({ [`GET ${URL_}`]: () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được cấu hình đăng nhập Google\./)
  })
})

// ─── Address bans ────────────────────────────────────────────────────────────

const BANS = [
  { id: 3, value: '203.0.113.0/24', reason: 'Spam bình luận', createdAt: '2026-10-20T02:00:00.000Z', createdBy: 1, createdByName: 'admin' },
  { id: 4, value: '198.51.100.7', reason: null, createdAt: null, createdBy: null, createdByName: null },
]

describe('pages/admin/settings/ip-bans.vue', () => {
  const PAGE = 'pages/admin/settings/ip-bans.vue'
  const server = (overrides: Record<string, Route> = {}) => routes({
    'GET /api/admin/ip-bans': () => json({ ok: true, bans: BANS }),
    'POST /api/admin/ip-bans': () => json({ ok: true, id: 9 }, 201),
    'DELETE /api/admin/ip-bans/4': () => json({ ok: true }),
    ...overrides,
  })
  const row = (opened: MountedAdminPage, value: string) =>
    findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').some(td => textOf(td) === value))[0]!
  const cells = (tr: MiniElement) => findAll(tr, el => el.tag === 'td').map(textOf)

  it('mount: one GET; NULL reason / author / time read "—", "Tài khoản đã xoá", "—"', async () => {
    const opened = await mountAdminPage(PAGE, server())
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/ip-bans'])
    assert.deepEqual(cells(row(opened, '198.51.100.7')), ['198.51.100.7', '—', 'Tài khoản đã xoá', '—', 'Bỏ chặn'])
    assert.deepEqual(cells(row(opened, '203.0.113.0/24')).slice(0, 3), ['203.0.113.0/24', 'Spam bình luận', 'admin'])
    assert.doesNotMatch(textOf(opened.page.root), /1970|Invalid Date|null|undefined/)
  })

  it('add: POSTs value + reason, toasts, clears the form, reloads', async () => {
    const opened = await mountAdminPage(PAGE, server())
    await input(byPlaceholder(opened, '203.0.113.45 hoặc 203.0.113.0/24'), '192.0.2.1')
    await input(field(opened, el => el.props.maxlength === '500'), 'Quấy rối')
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'POST /api/admin/ip-bans', body: { value: '192.0.2.1', reason: 'Quấy rối' } }, 'GET /api/admin/ip-bans'])
    assert.equal(opened.lastToast('success'), 'Đã thêm vào danh sách chặn.')
    assert.equal(modelOf(byPlaceholder(opened, '203.0.113.45 hoặc 203.0.113.0/24')), '')
  })

  it('add refused: the server\'s sentence stays INLINE (role="alert"), not a toast', async () => {
    const sentence = 'Chưa hỗ trợ chặn theo dải IPv6 — hãy nhập một địa chỉ IPv6 đầy đủ.'
    const opened = await mountAdminPage(PAGE, server({ 'POST /api/admin/ip-bans': () => h3Error(400, sentence) }))
    await input(byPlaceholder(opened, '203.0.113.45 hoặc 203.0.113.0/24'), '2001:db8::/32')
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.match(alertText(opened.page), new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal(opened.toasts.length, 0)
    assertOnlyServerSentences(opened)
  })

  it('lift: confirmed → DELETE + reload; declined → nothing; refused → the server\'s sentence', async () => {
    const opened = await mountAdminPage(PAGE, server())
    opened.answers.confirm = false
    const before = opened.calls.length
    await click(buttons(row(opened, '198.51.100.7'), 'Bỏ chặn')[0]!)
    await settle()
    assert.equal(opened.calls.length, before)
    assert.match(opened.confirms.at(-1)?.message ?? '', /^Bỏ chặn 198\.51\.100\.7\?/)
    opened.answers.confirm = true
    await click(buttons(row(opened, '198.51.100.7'), 'Bỏ chặn')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/ip-bans/4', 'GET /api/admin/ip-bans'])
    assert.equal(opened.lastToast('success'), 'Đã bỏ chặn địa chỉ.')

    const refused = await mountAdminPage(PAGE, server({ 'DELETE /api/admin/ip-bans/4': () => h3Error(404, 'Không tìm thấy mục chặn.') }))
    await click(buttons(row(refused, '198.51.100.7'), 'Bỏ chặn')[0]!)
    await settle()
    assert.equal(refused.lastToast('error'), 'Không tìm thấy mục chặn.')
  })

  it('empty list / load failure / retry / dropped connection / `ok: false`', async () => {
    const empty = await mountAdminPage(PAGE, routes({ 'GET /api/admin/ip-bans': () => json({ ok: true, bans: [] }) }))
    assert.match(textOf(empty.page.root), /Chưa chặn địa chỉ nào\./)
    await assertLoadFailureContract(PAGE, '/api/admin/ip-bans', 'Không tải được danh sách chặn.', () => json({ ok: true, bans: BANS }), 'Thử lại')
    const notOk = await mountAdminPage(PAGE, routes({ 'GET /api/admin/ip-bans': () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được danh sách chặn\./)
  })
})

// ─── MFA policy ──────────────────────────────────────────────────────────────

const POLICY = {
  ok: true, policy: 'off', enforceAfter: null, graceDays: 14, killSwitch: false,
  withoutFactor: { privileged: [{ id: 5, username: 'bientap', roleName: null }], all: [{ id: 5, username: 'bientap', roleName: null }, { id: 6, username: 'nv', roleName: 'editor' }] },
}

describe('pages/admin/settings/security.vue', () => {
  const PAGE = 'pages/admin/settings/security.vue'
  const URL_ = '/api/admin/security/mfa-policy'
  let fetchedUser = 0
  const options: MountOptions = { auto: { useAdminAuth: () => ({ fetchUser: async () => { fetchedUser++ } }) } }
  const server = (overrides: Record<string, Route> = {}) => routes({
    [`GET ${URL_}`]: () => json(POLICY),
    [`PUT ${URL_}`]: () => json({ ok: true, policy: 'all', enforceAfter: '2026-11-11T00:00:00.000Z', changed: true }),
    ...overrides,
  })
  const radio = (opened: MountedAdminPage, value: string) => field(opened, el => el.props.type === 'radio' && el.props.value === value)

  it('save: confirm names the accounts still without a factor; PUT {policy}; reload + `me` re-read', async () => {
    fetchedUser = 0
    const opened = await mountAdminPage(PAGE, server(), options)
    assert.deepEqual(opened.calls.map(wire), [`GET ${URL_}`])
    assert.equal(modelOf(radio(opened, 'off')), 'off')
    await input(radio(opened, 'all'), 'all')
    assert.match(textOf(opened.page.root), /2 tài khoản thuộc diện chưa bật/)
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.match(opened.confirms.at(-1)?.message ?? '', /Sau 14 ngày[\s\S]*Hiện 2 tài khoản chưa bật: bientap, nv\./)
    assert.deepEqual(sent(opened.calls, before), [{ wire: `PUT ${URL_}`, body: { policy: 'all' } }, `GET ${URL_}`])
    assert.equal(fetchedUser, 1, 'the signed-in account is re-read so its banner shows at once')
    assert.equal(opened.lastToast('success'), 'Đã bật chính sách. Thời hạn chuyển tiếp bắt đầu từ bây giờ.')
  })

  it('declined → nothing sent; refused → the server\'s sentence', async () => {
    const opened = await mountAdminPage(PAGE, server({ [`PUT ${URL_}`]: () => h3Error(403, 'Chỉ SuperAdmin mới được đổi chính sách này.') }), options)
    await input(radio(opened, 'privileged'), 'privileged')
    opened.answers.confirm = false
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.equal(opened.calls.length, before)
    opened.answers.confirm = true
    await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.equal(opened.lastToast('error'), 'Chỉ SuperAdmin mới được đổi chính sách này.')
    assertOnlyServerSentences(opened)
  })

  it('load failure / retry / dropped connection', async () => {
    await assertLoadFailureContract(PAGE, URL_, 'Không tải được chính sách xác thực hai bước.', () => json(POLICY), 'Thử lại', {}, options)
  })
})

// ─── Sitemap ─────────────────────────────────────────────────────────────────

const XML = '<?xml version="1.0"?><urlset></urlset>'
const GENERATED = '<?xml version="1.0"?><urlset><url><loc>https://cdkt.example.vn/</loc></url></urlset>'

describe('pages/admin/settings/sitemap.vue', () => {
  const PAGE = 'pages/admin/settings/sitemap.vue'
  const server = (overrides: Record<string, Route> = {}) => routes({
    'GET /api/admin/settings/sitemap': () => json({ ok: true, xml: XML, updatedAt: '2026-10-20T02:00:00.000Z', generated: GENERATED }),
    'POST /api/admin/settings/sitemap/generate': () => json({ ok: true, xml: GENERATED }),
    'PUT /api/admin/settings/sitemap': () => json({ ok: true, updatedAt: '2026-10-28T03:00:00.000Z' }),
    ...overrides,
  })
  const textarea = (opened: MountedAdminPage) => field(opened, el => el.tag === 'textarea')

  it('mount: the saved XML and its time; with nothing saved, the generated one and no time', async () => {
    const opened = await mountAdminPage(PAGE, server())
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/settings/sitemap'])
    assert.equal(modelOf(textarea(opened)), XML)
    assert.match(textOf(opened.page.root), new RegExp(`Lần lưu cuối: ${new Date('2026-10-20T02:00:00.000Z').toLocaleString('vi-VN')}`))
    assert.ok(buttons(opened.page, 'Sinh lại')[0])

    const fresh = await mountAdminPage(PAGE, server({ 'GET /api/admin/settings/sitemap': () => json({ ok: true, xml: null, updatedAt: null, generated: GENERATED }) }))
    assert.equal(modelOf(textarea(fresh)), GENERATED)
    assert.doesNotMatch(textOf(fresh.page.root), /Lần lưu cuối/)
    assert.ok(buttons(fresh.page, 'Sinh sitemap')[0])
  })

  it('generate over a saved copy asks first; confirmed → POST generate fills the box', async () => {
    const opened = await mountAdminPage(PAGE, server())
    opened.answers.confirm = false
    const before = opened.calls.length
    await click(buttons(opened.page, 'Sinh lại')[0]!)
    await settle()
    assert.equal(opened.calls.length, before)
    opened.answers.confirm = true
    await click(buttons(opened.page, 'Sinh lại')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['POST /api/admin/settings/sitemap/generate'])
    assert.equal(modelOf(textarea(opened)), GENERATED)
    assert.equal(opened.lastToast('success'), 'Đã sinh sitemap từ dữ liệu hiện tại. Bấm "Lưu" để áp dụng.')
  })

  it('save: PUT {xml}; the answer\'s time shows; a refusal toasts the server\'s sentence', async () => {
    const opened = await mountAdminPage(PAGE, server())
    await input(textarea(opened), GENERATED)
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lưu'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'PUT /api/admin/settings/sitemap', body: { xml: GENERATED } }])
    assert.match(textOf(opened.page.root), new RegExp(`Lần lưu cuối: ${new Date('2026-10-28T03:00:00.000Z').toLocaleString('vi-VN')}`))
    assert.equal(opened.lastToast('success'), 'Đã lưu sitemap.')

    const refused = await mountAdminPage(PAGE, server({ 'PUT /api/admin/settings/sitemap': () => h3Error(400, 'Sitemap không được để trống.') }))
    await click(byText(refused.page.root, 'button', 'Lưu'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Sitemap không được để trống.')
    const failedGenerate = await mountAdminPage(PAGE, server({ 'POST /api/admin/settings/sitemap/generate': () => dropped() }))
    failedGenerate.answers.confirm = true
    await click(buttons(failedGenerate.page, 'Sinh lại')[0]!)
    await settle()
    assert.equal(failedGenerate.lastToast('error'), 'Không sinh được sitemap.')
    assertOnlyServerSentences(failedGenerate)
  })

  it('load failure / retry / dropped connection / `ok: false`', async () => {
    await assertLoadFailureContract(PAGE, '/api/admin/settings/sitemap', 'Không tải được sitemap.', () => json({ ok: true, xml: XML, updatedAt: null, generated: GENERATED }), 'thử lại')
    const notOk = await mountAdminPage(PAGE, routes({ 'GET /api/admin/settings/sitemap': () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được sitemap\./)
  })
})

// ─── Data retention ──────────────────────────────────────────────────────────

const SCOPES = [
  { scope: 'activity_logs', days: 365, daysSource: 'database', maxRows: 0, maxRowsSource: 'default', total: 1200, oldest: '2025-01-01T00:00:00.000Z', overdue: 5, overRowCap: 0, purgedTotal: 40, lifetimeTotal: 1240, lastRunAt: null, lastDeleted: 0, lastTrigger: null, lastStatus: null, lastMessage: null },
  { scope: 'chat_sessions', days: 30, daysSource: 'environment', maxRows: 5000, maxRowsSource: 'database', total: 10, oldest: null, overdue: 0, overRowCap: 0, purgedTotal: 0, lifetimeTotal: 10, lastRunAt: '2026-10-27T20:00:00.000Z', lastDeleted: 3, lastTrigger: 'scheduler', lastStatus: 'success', lastMessage: null },
]
const RETENTION = { ok: true, scopes: SCOPES, command: 'npm run analytics:maintenance', autoEnabled: true, runHour: 4, autoEnabledSource: 'database', runHourSource: 'default' }

describe('pages/admin/settings/data-retention.vue', () => {
  const PAGE = 'pages/admin/settings/data-retention.vue'
  const server = (overrides: Record<string, Route> = {}) => routes({
    'GET /api/admin/settings/retention': () => json(RETENTION),
    'PUT /api/admin/settings/retention': () => json({ ok: true, policy: {} }),
    'POST /api/admin/settings/retention-run': () => json({ ok: true, status: 'warning', tables: [{ table: 'activity_logs', deleted: 1500 }, { table: 'chat_sessions', deleted: 2 }], message: null, auditFailed: false }),
    ...overrides,
  })

  it('save: PUTs the switch, the hour and the two numbers of each scope the server listed; reloads', async () => {
    const opened = await mountAdminPage(PAGE, server())
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/settings/retention'])
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lưu cấu hình'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/settings/retention', body: { autoEnabled: true, runHour: 4, activityLogDays: 365, activityLogMaxRows: 0, chatSessionDays: 30, chatSessionMaxRows: 5000 } },
      'GET /api/admin/settings/retention',
    ])
    assert.equal(opened.lastToast('success'), 'Đã lưu cấu hình dọn dữ liệu.')
  })

  it('run now: confirm lists the overdue tables; POST {confirm:true}; a "warning" run says rows remain; a refusal its sentence', async () => {
    const opened = await mountAdminPage(PAGE, server())
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Dọn ngay'))
    await settle()
    assert.match(opened.confirms.at(-1)?.message ?? '', /Lịch sử hoạt động: khoảng 5 bản ghi/)
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'POST /api/admin/settings/retention-run', body: { confirm: true } }, 'GET /api/admin/settings/retention'])
    assert.equal(opened.lastToast('info'), `Đã xoá ${new Intl.NumberFormat('vi-VN').format(1502)} bản ghi. Còn bản ghi chờ lượt sau.`)

    const locked = await mountAdminPage(PAGE, server({ 'POST /api/admin/settings/retention-run': () => h3Error(409, 'Một lượt dọn khác đang chạy. Thử lại sau ít phút.') }))
    await click(byText(locked.page.root, 'button', 'Dọn ngay'))
    await settle()
    assert.equal(locked.lastToast('error'), 'Một lượt dọn khác đang chạy. Thử lại sau ít phút.')
    const refusedSave = await mountAdminPage(PAGE, server({ 'PUT /api/admin/settings/retention': () => h3Error(400, 'Số ngày lưu phải từ 7 đến 3650.') }))
    await click(byText(refusedSave.page.root, 'button', 'Lưu cấu hình'))
    await settle()
    assert.equal(refusedSave.lastToast('error'), 'Số ngày lưu phải từ 7 đến 3650.')
    assertOnlyServerSentences(refusedSave)
  })

  it('load failure / retry / dropped connection / `ok: false`', async () => {
    await assertLoadFailureContract(PAGE, '/api/admin/settings/retention', 'Không tải được cấu hình dọn dữ liệu.', () => json(RETENTION), 'thử lại')
    const notOk = await mountAdminPage(PAGE, routes({ 'GET /api/admin/settings/retention': () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được cấu hình dọn dữ liệu\./)
  })
})

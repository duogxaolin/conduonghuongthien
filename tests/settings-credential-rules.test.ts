import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import * as shared from '../shared/settings-credential-rules'
import * as smtp from '../server/utils/smtp-test-config'
import * as guard from '../server/utils/settings-credential-guard'

/**
 * `shared/settings-credential-rules.ts` is the "change the destination → retype the
 * secret" rule for SMTP, image R2 and video R2. The server decides with it
 * (settings/index.put.ts, settings/media-portal.put.ts — behaviour pinned in
 * tests/settings-credential-retarget.test.ts and tests/media-portal-r2-retarget.test.ts);
 * the admin pages run the SAME function before sending, so the officer sees the
 * reason next to the field instead of a bare 400.
 *
 * What this file pins:
 *  1. `server/utils/smtp-test-config.ts` (the "send test email" endpoint) uses the
 *     SMTP rules of `shared/` itself — the same bindings, no copy. It used to keep its
 *     own copy of the port list, the target normaliser and the mask, held equal only
 *     by a parity test (rà soát trùng lặp 2026-10-25, T1): a port added on one side
 *     would have made "send test" and "save" decide differently;
 *  2. the page's view of "what is stored" (secrets MASKED, as the GET returns them)
 *     gives the same verdict as the server's view (real secrets) for every form;
 *  3. the three pages actually call the guard before their save request, and the
 *     email page no longer tells officers that a blank password "keeps" it.
 */

// ─── 1. The test-email endpoint uses the shared SMTP rules, not a copy ────────
test('SMTP: smtp-test-config exports the shared bindings themselves', () => {
  assert.equal(smtp.SMTP_ALLOWED_PORTS, shared.SMTP_ALLOWED_PORTS, 'the port list must be the same array, not an equal copy')
  assert.equal(smtp.effectiveSmtpPort, shared.effectiveSmtpPort)
  assert.equal(smtp.isAllowedSmtpPort, shared.isAllowedSmtpPort)
  assert.equal(smtp.smtpTargetOf, shared.smtpTargetOf)
  assert.equal(smtp.sameSmtpTarget, shared.sameSmtpTarget)
  assert.equal(smtp.SMTP_PORT_NOT_ALLOWED_MESSAGE, shared.SMTP_PORT_NOT_ALLOWED_MESSAGE)
  assert.equal(smtp.MASKED_SMTP_PASSWORD, shared.MASKED_SECRET)
})

test('SMTP: smtp-test-config defines no SMTP port list or target rule of its own', () => {
  const source = readFileSync(new URL('../server/utils/smtp-test-config.ts', import.meta.url), 'utf8')
  assert.match(source, /from '\.\.\/\.\.\/shared\/settings-credential-rules'/, 'imports the rules from shared/')
  assert.doesNotMatch(source, /\[[^\]]*\b465\b[^\]]*\b587\b[^\]]*\]/, 'a port list literal is a second copy of the allowlist')
  assert.doesNotMatch(source, /\b(SMTP_ALLOWED_PORTS|SMTP_PORT_NOT_ALLOWED_MESSAGE|MASKED_SMTP_PASSWORD|isTruthy)\s*(:[^=\n]*)?=/)
  assert.doesNotMatch(source, /function\s+(effectiveSmtpPort|isAllowedSmtpPort|smtpTargetOf|sameSmtpTarget)\b/)
  assert.doesNotMatch(source, /interface\s+SmtpTarget\b/)
})

test('SMTP: the test-email body\'s "secure" uses the shared truthiness rule', () => {
  for (const [value, secure] of [['true', true], [' ON ', true], ['1', true], ['yes', true], ['false', false], ['0', false], ['', false], [undefined, false]] as const) {
    const decision = smtp.resolveSmtpTestConfig({ smtp_host: 'smtp.new.vn', smtp_user: 'u@new.vn', smtp_pass: 'typed', smtp_secure: value }, null)
    assert.equal(decision.config?.secure, secure, String(value))
    assert.equal(shared.isTruthy(value), secure, String(value))
  }
})

test('the server guard is the shared function, not a copy', () => {
  assert.equal(guard.credentialRetargetViolation, shared.credentialRetargetViolation)
  assert.equal(guard.videoR2RetargetViolation, shared.videoR2RetargetViolation)
  assert.equal(guard.isCloudflareAccountId, shared.isCloudflareAccountId)
})

// ─── 2. The page's masked view gives the server's verdict ─────────────────────
const ACCOUNT = '0123456789abcdef0123456789abcdef'
const STORED = new Map(Object.entries({
  smtp_host: 'smtp.real.vn', smtp_port: '587', smtp_secure: 'false', smtp_user: 'portal@real.vn', smtp_pass: 'REAL-SMTP-SECRET', smtp_from: 'portal@real.vn',
  media_provider: 'r2', r2_account_id: ACCOUNT, r2_access_key: 'AKID', r2_secret_key: 'REAL-R2-SECRET', r2_bucket: 'cdkt-media', r2_public_url: 'https://cdn.example.vn',
}))
/** What a non-SuperAdmin's page holds after GET /api/admin/settings. */
const MASKED_VIEW = new Map([...STORED].map(([k, v]) => [k, k === 'smtp_pass' || k === 'r2_secret_key' ? '********' : v]))
const emailForm = Object.fromEntries([...MASKED_VIEW].filter(([k]) => k.startsWith('smtp_')))
const r2Form = Object.fromEntries([...MASKED_VIEW].filter(([k]) => !k.startsWith('smtp_')))

const FORMS: Array<[string, Record<string, unknown>, RegExp | null]> = [
  ['email page untouched', emailForm, null],
  ['email: new host, mask kept', { ...emailForm, smtp_host: 'mail.attacker.example' }, /nhập lại mật khẩu SMTP/],
  ['email: new host, blank password', { ...emailForm, smtp_host: 'mail.attacker.example', smtp_pass: '' }, /nhập lại mật khẩu SMTP/],
  ['email: new user, mask kept', { ...emailForm, smtp_user: 'x@attacker.example' }, /nhập lại mật khẩu SMTP/],
  ['email: secure toggled, mask kept', { ...emailForm, smtp_secure: 'true' }, /nhập lại mật khẩu SMTP/],
  ['email: new host + typed password', { ...emailForm, smtp_host: 'smtp.new.vn', smtp_pass: 'typed' }, null],
  ['email: port 6379 with typed password', { ...emailForm, smtp_port: '6379', smtp_pass: 'typed' }, /Cổng SMTP không được phép/],
  ['email: port 2525 with typed password', { ...emailForm, smtp_port: '2525', smtp_pass: 'typed' }, null],
  ['email: blank password, same host (deletes it, allowed)', { ...emailForm, smtp_pass: '' }, null],
  ['email: only sender changed', { ...emailForm, smtp_from: 'noreply@real.vn' }, null],
  ['r2 page untouched', r2Form, null],
  ['r2: new account id, mask kept', { ...r2Form, r2_account_id: 'fedcba9876543210fedcba9876543210' }, /nhập lại Secret Access Key/],
  ['r2: new account id + typed secret', { ...r2Form, r2_account_id: 'fedcba9876543210fedcba9876543210', r2_secret_key: 'typed' }, null],
  ['r2: steering account id', { ...r2Form, r2_account_id: 'evil.example#', r2_secret_key: 'typed' }, /32 ký tự hex/],
  ['r2: bad bucket', { ...r2Form, r2_bucket: 'evil.example' }, /Tên bucket R2 không hợp lệ/],
  ['r2: new valid bucket, mask kept', { ...r2Form, r2_bucket: 'new-bucket' }, null],
]

for (const [label, body, expected] of FORMS) {
  test(`masked page view == server view: ${label}`, () => {
    const onPage = shared.credentialRetargetViolation(body, MASKED_VIEW)
    const onServer = shared.credentialRetargetViolation(body, STORED)
    assert.equal(onPage, onServer)
    if (expected) assert.match(onServer ?? '', expected)
    else assert.equal(onServer, null)
  })
}

test('SuperAdmin view (real R2 secret in the form) is allowed to change the account id, on page and server alike', () => {
  const saForm = Object.fromEntries([...STORED].filter(([k]) => k.startsWith('r2_') || k === 'media_provider'))
  const body = { ...saForm, r2_account_id: 'fedcba9876543210fedcba9876543210' }
  assert.equal(shared.credentialRetargetViolation(body, STORED), null)
})

// ─── Video R2 (media-portal) ──────────────────────────────────────────────────
test('video R2: account id / bucket changes need the secret; formats are checked only on change', () => {
  const stored = { accountId: ACCOUNT, bucket: 'cdkt-video', secretStored: true }
  const same = { videoR2AccountId: ACCOUNT, videoR2Bucket: 'cdkt-video', videoR2SecretKey: '' }
  assert.equal(shared.videoR2RetargetViolation(same, stored), null)
  assert.equal(shared.videoR2RetargetViolation({ ...same, videoR2AccountId: ` ${ACCOUNT} ` }, stored), null, 'whitespace is not a change')
  assert.match(shared.videoR2RetargetViolation({ ...same, videoR2AccountId: 'fedcba9876543210fedcba9876543210' }, stored)!, /nhập lại R2 Secret Key/)
  assert.match(shared.videoR2RetargetViolation({ ...same, videoR2Bucket: 'other-bucket' }, stored)!, /nhập lại R2 Secret Key/)
  assert.match(shared.videoR2RetargetViolation({ ...same, videoR2Bucket: 'other-bucket', videoR2SecretKey: '  ' }, stored)!, /nhập lại R2 Secret Key/)
  assert.equal(shared.videoR2RetargetViolation({ ...same, videoR2Bucket: 'other-bucket', videoR2SecretKey: 'typed' }, stored), null)
  assert.match(shared.videoR2RetargetViolation({ ...same, videoR2AccountId: 'evil.example#', videoR2SecretKey: 'typed' }, stored)!, /32 ký tự hex/)
  assert.match(shared.videoR2RetargetViolation({ ...same, videoR2Bucket: 'a/b', videoR2SecretKey: 'typed' }, stored)!, /bucket R2 không hợp lệ/)
  assert.equal(shared.videoR2RetargetViolation({ ...same, videoR2AccountId: 'fedcba9876543210fedcba9876543210' }, { ...stored, secretStored: false }), null)
  assert.equal(shared.videoR2RetargetViolation({ videoR2AccountId: 'legacy', videoR2Bucket: 'cdkt-video' }, { ...stored, accountId: 'legacy' }), null, 'legacy unchanged value resent')
  assert.equal(shared.videoR2RetargetViolation({ processingMaxJobs: '2' }, stored), null, 'fields absent = unchanged')
})

// ─── 3. The pages call the guard before saving ────────────────────────────────
function script(file: string) {
  const { descriptor, errors } = parse(readFileSync(new URL(`../app/pages/admin/settings/${file}`, import.meta.url), 'utf8'), { filename: file })
  assert.equal(errors.length, 0, file)
  return { script: descriptor.scriptSetup?.content ?? '', template: descriptor.template?.content ?? '' }
}

for (const [file, guardCall, saveFn] of [
  ['email.vue', 'credentialRetargetViolation(', 'handleSave'],
  ['media-storage.vue', 'credentialRetargetViolation(', 'handleSave'],
  ['media-portal.vue', 'videoR2RetargetViolation(', 'save'],
] as const) {
  test(`${file}: imports the shared rule and refuses to send a save it would reject`, () => {
    const { script: src } = script(file)
    assert.match(src, /from '~~\/shared\/settings-credential-rules'/)
    assert.ok(src.includes(guardCall), `calls ${guardCall}`)
    const start = src.search(new RegExp(`(const ${saveFn} = async \\(|async function ${saveFn}\\()`))
    assert.ok(start >= 0, `defines ${saveFn}`)
    const body = src.slice(start)
    const guardAt = body.search(/if \((formViolation|r2Violation)\.value\)/)
    const fetchAt = body.indexOf('$fetch')
    assert.ok(guardAt >= 0 && fetchAt > guardAt, 'the guard runs before the save request')
  })
}

test('email.vue: the password hint tells the truth (blank deletes; host/port/user/secure need the password; port list)', () => {
  const { template } = script('email.vue')
  assert.doesNotMatch(template, /Để trống hoặc giữ nguyên dấu \*{8} nếu không muốn thay đổi/)
  assert.match(template, /Xoá trắng ô này rồi lưu sẽ XOÁ mật khẩu đã lưu/)
  assert.match(template, /Đổi host, cổng, tài khoản hoặc chế độ bảo mật thì phải nhập lại mật khẩu/)
  assert.match(template, /SMTP_ALLOWED_PORTS\.join/)
  assert.match(template, /passwordWillBeDeleted/)
})

test('media-storage.vue / media-portal.vue: Account ID errors are shown inline with the field', () => {
  const storage = script('media-storage.vue').template
  assert.match(storage, /:aria-invalid="Boolean\(accountIdError\)"/)
  assert.match(storage, /:aria-invalid="Boolean\(secretError\)"/)
  const portal = script('media-portal.vue').template
  assert.match(portal, /:aria-invalid="Boolean\(r2AccountIdError\)"/)
  assert.match(portal, /:aria-invalid="Boolean\(r2SecretError\)"/)
})

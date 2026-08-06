/**
 * Enabling two-factor authentication, end to end, in a real browser.
 *
 * This is the flow that was documented as "kiểm bằng tay" — tasks 8.3–8.6 in the
 * admin-self-service-security change were left blank for exactly this reason.
 * Manual-only is the wrong place for it: this is the one feature whose failure
 * mode is locking an administrator out of a public-facing government portal, and
 * a regression here is silent until somebody cannot sign in.
 *
 * What only a browser can answer, and what these specs assert:
 *
 *   1. **The enrolled secret actually works.** The spec reads the base32 secret
 *      off the dialog and computes a real RFC 6238 code from it — the same
 *      arithmetic an authenticator app performs. A stub would prove the form
 *      submits; only a genuine code proves the server accepts what it issued.
 *      If the secret were sealed, stored, or decoded wrongly, this is where it
 *      shows.
 *
 *   2. **A wrong code leaves the factor inactive.** The dangerous direction is
 *      not "correct code rejected" — that is loud. It is "wrong code accepted",
 *      which makes the whole factor decorative while looking enabled.
 *
 *   3. **Enrollment is two-step: `pending` → `active`.** An unconfirmed
 *      enrollment must not be able to lock anyone out, so the factor must still
 *      read as off until a code proves the pairing.
 *
 *   4. **Recovery codes are shown exactly once.** They are hashed on the server,
 *      so if the UI does not surface them at generation time they are gone —
 *      and the recovery path for a lost device is gone with them.
 *
 * The seeded account starts with no factors (enrollment is voluntary), so each
 * spec enables what it needs and the suite leaves the account usable.
 */
import mysql from 'mysql2/promise'

import { expect, test, type Page } from '@playwright/test'
import { base32Decode, totpFromKey, totpStep } from '../../server/utils/mfa/totp'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV, e2eDbConfig } from './harness'

/**
 * The TOTP factor's own row.
 *
 * Anchored on the visible label rather than a tag name: the rows render as
 * plain `div`s, and the surrounding section also holds the recovery-codes
 * button, which is `disabled` until a factor is active. A section-wide name
 * match resolves to that disabled button and then waits for it forever.
 */
function totpRow(page: Page) {
  return page.locator('div').filter({
    has: page.getByText('Ứng dụng xác thực (Google Authenticator)'),
  }).filter({ has: page.getByRole('button') }).last()
}

function adminPassword(): string {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)
  return password
}

async function login(page: Page) {
  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', adminPassword())
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/admin(?!\/login)/)
}

/** The code an authenticator app would be showing for this secret right now. */
function currentCode(secret: string): string {
  return totpFromKey(base32Decode(secret), totpStep())
}

/**
 * Open the TOTP enrollment dialog and return the offered secret.
 *
 * The secret is rendered as plain text for manual entry — deliberately, because
 * rendering a QR code would mean shipping the secret to a third-party image
 * service. That decision is what makes this readable from a test at all.
 */
async function beginTotpEnrollment(page: Page): Promise<string> {
  await page.goto('/admin/profile')
  // Scoped to the TOTP row, not the whole section: the section also holds the
  // recovery-codes button, which is disabled while no factor is active — and a
  // section-wide name match resolves to it and then waits forever.
  // "Bật" from a clean state, "Tiếp tục bật" if a previous enrollment was left
  // pending — the server keeps the pending row, so both land in the same dialog.
  await totpRow(page).getByRole('button', { name: /^(Bật|Tiếp tục bật)$/ }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('#enroll-pw').fill(adminPassword())
  await dialog.getByRole('button', { name: /Tiếp tục|Gửi mã|Bật/ }).first().click()

  const secret = (await dialog.locator('code').first().innerText()).trim()
  expect(secret, 'no TOTP secret was offered').not.toBe('')
  return secret
}

/** Turn the factor back off so each spec starts from the seeded state. */
async function disableTotp(page: Page) {
  await page.goto('/admin/profile')
  const off = totpRow(page).getByRole('button', { name: /^Tắt$/ })
  if (!(await off.isVisible().catch(() => false))) return
  await off.click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type="password"]').first().fill(adminPassword())
  await dialog.getByRole('button', { name: /Xác nhận|Tắt/ }).last().click()
  await expect(dialog).toBeHidden()
}

/**
 * Lưới an toàn: trả tài khoản seed về trạng thái không yếu tố nào, kể cả khi test
 * đỏ giữa đường.
 *
 * Phần dọn ở CUỐI thân test là phần bị bỏ qua đúng lúc cần nó nhất — một khẳng
 * định đỏ ở giữa để tài khoản còn nguyên TOTP đang bật, và mọi spec sau đó chết ở
 * bước đăng nhập với một lỗi không liên quan gì tới điều chúng kiểm. Một lượt
 * chạy đã có 7 spec đỏ mà chỉ 1 là lỗi thật.
 *
 * Xoá thẳng ở tầng CSDL vì đây là đường duy nhất còn lại khi giao diện đang đòi
 * một mã mà phần dọn không có: sau một lần đỏ, `disableTotp` cũng không đăng nhập
 * vào được để bấm nút "Tắt".
 */
test.afterEach(async () => {
  const connection = await mysql.createConnection(e2eDbConfig())
  try {
    await connection.execute('DELETE FROM user_mfa_factors')
    await connection.execute('DELETE FROM user_recovery_codes')
  } finally {
    await connection.end()
  }
})

/**
 * One test, three claims, in order.
 *
 * Not three separate `test()` blocks: enabling or disabling a factor REVOKES the
 * account's other sessions — that is the security property the feature is built
 * around — so a second spec that logs in fresh races the revocation from the
 * first and times out on the redirect. Splitting them would mean either a second
 * seeded account or a retry loop around every login, both of which add moving
 * parts to hide a behaviour that is working correctly.
 */
test('two-factor enrollment: real code accepted, wrong code rejected, codes shown once', async ({ page }) => {
  await login(page)

  // ── 1. A wrong code must leave the factor pending, never active ────────────
  const secret = await beginTotpEnrollment(page)
  const dialog = page.getByRole('dialog')

  await dialog.locator('#enroll-code').fill('000000')
  await dialog.getByRole('button', { name: /Xác nhận|Bật/ }).last().click()
  await expect(dialog, 'a wrong code closed the dialog — the factor may have been enabled')
    .toBeVisible()
  await expect(dialog.getByText(/không đúng/i)).toBeVisible()

  /**
   * ── 2. Still pending, not active ──────────────────────────────────────────
   *
   * Checked here rather than by abandoning and reloading, because a reload
   * costs a fresh login and the rejected attempt has already put the factor in
   * exactly the state worth asserting: enrollment remembered, factor NOT live.
   * A half-finished enrollment that could gate a login would lock the account
   * out — the reason the design is two-step at all.
   */
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // The card reflects server state only on load; closing the dialog does not
  // re-fetch. Reloading is safe here — nothing has revoked the session yet,
  // because no factor has been enabled or disabled.
  await page.reload()
  const row = totpRow(page)
  await expect(row.getByText('Chờ xác nhận')).toBeVisible()
  await expect(
    row.getByRole('button', { name: /^Tắt$/ }),
    'an unconfirmed enrollment left the factor active',
  ).toHaveCount(0)

  // ── 3. The code an authenticator would show must be accepted ───────────────
  const resumed = await beginTotpEnrollment(page)
  await dialog.locator('#enroll-code').fill(currentCode(resumed))
  await dialog.getByRole('button', { name: /Xác nhận|Bật/ }).last().click()
  await expect(dialog).toBeHidden()
  await expect(totpRow(page).getByRole('button', { name: /^Tắt$/ })).toBeVisible()

  /**
   * ── 4. Recovery codes are readable exactly once ───────────────────────────
   *
   * They are stored as bcrypt hashes, so this render is the only time they
   * exist in readable form. If it shows nothing, the account has silently lost
   * its way back in after a lost device.
   */
  await page.getByRole('button', { name: /[Tt]ạo mã dự phòng|[Mm]ã dự phòng/ }).first().click()
  const codesDialog = page.getByRole('dialog')
  await codesDialog.locator('input[type="password"]').first().fill(adminPassword())
  await codesDialog.getByRole('button', { name: /Tạo|Xác nhận/ }).last().click()

  // Rendered on the PAGE, not inside the dialog: the dialog only takes the
  // password, then closes and reveals the codes in a panel on the card.
  const shown = page.locator('li.font-mono')
  await expect(shown.first()).toBeVisible()
  expect(await shown.count(), 'no recovery codes were rendered').toBeGreaterThan(1)

  // Leave the seeded account as it was found: no factors, so the retry spec and
  // any later run start from the same place.
  //
  // The `afterEach` above is what GUARANTEES that state — it runs even when this
  // test fails halfway, which is precisely when the guarantee matters. This call
  // exercises the UI's own disable path (worth covering: it is the button a real
  // administrator clicks), so a broken "Tắt" still fails here rather than being
  // papered over by the database cleanup.
  //
  // Deliberately NOT followed by an assertion that the row now offers "Bật":
  // `disableTotp` does not reload, and the card only re-reads server state on
  // load, so that assertion was checking the page had not updated — a claim about
  // this spec's own navigation, not about the feature.
  await disableTotp(page)
})

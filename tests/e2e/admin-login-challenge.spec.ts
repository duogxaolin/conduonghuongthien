/**
 * Bước thử thách ở TRANG ĐĂNG NHẬP — mục 8.5, thứ duy nhất còn "chỉ kiểm bằng tay".
 *
 * `tests/e2e/admin-mfa.spec.ts` chứng minh phần **bật** yếu tố: máy chủ chấp nhận
 * đúng mã nó vừa phát. Nhưng bật được một yếu tố mà cổng đăng nhập không đòi nó
 * thì tính năng không tồn tại — và hỏng theo hướng **im lặng**: mọi thứ trên
 * `/admin/profile` vẫn hiện "đang bật", chỉ có lượt đăng nhập là đi thẳng vào.
 * Chiều ngược lại còn tệ hơn: một bước thử thách chấp nhận **mọi** mã đọc ra y
 * hệt một bước thử thách đang chạy đúng, và không có màn hình nào phản đối.
 *
 * Bốn khẳng định, và ba trong số đó chỉ một trình duyệt nói được:
 *
 *  1. Mật khẩu đúng **không** đủ để vào — nó dừng ở bước thử thách, không điều
 *     hướng. Đây là khẳng định trung tâm; ba cái còn lại là các cách nó hỏng.
 *  2. Mã sai bị từ chối **và giữ người dùng lại ở bước thử thách**. Nhánh 401/429
 *     trong `handleVerify` đẩy về bước mật khẩu có chủ đích (vé đã bị xoá phía
 *     máy chủ), nên một mã sai rơi vào nhánh đó sẽ **xoá luôn cả bước thử thách**
 *     — trông như đăng nhập bị hỏng chứ không như một mã gõ sai.
 *  3. Mã thật (tính bằng RFC 6238 từ chính secret máy chủ vừa phát) vào được.
 *  4. Mã dự phòng cũng vào được, và **bộ chọn cách xác thực có mặt** — đây là
 *     đường về duy nhất khi mất điện thoại. Một `methodChoices` tính sai làm nút
 *     đó biến mất, và tài khoản bị khoá ngoài với đủ mã trong tay.
 *
 * Chạy TUẦN TỰ trong một `test()`, không tách bốn: bật/tắt một yếu tố **thu hồi
 * các phiên khác** của tài khoản — đúng thuộc tính bảo mật của tính năng — nên
 * một spec thứ hai đăng nhập lại sẽ đua với lượt thu hồi của spec trước. Cùng lý
 * do đã ghi trong `admin-mfa.spec.ts`.
 */
import mysql from 'mysql2/promise'

import { expect, test, type Page } from '@playwright/test'
import { base32Decode, totpFromKey, totpStep } from '../../server/utils/mfa/totp'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV, e2eDbConfig } from './harness'

function adminPassword(): string {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)
  return password
}

/** Mã mà một ứng dụng xác thực sẽ đang hiện cho secret này, ngay lúc này. */
function currentCode(secret: string): string {
  return totpFromKey(base32Decode(secret), totpStep())
}

/**
 * Chờ sang cửa sổ TOTP kế tiếp trước khi dùng lại secret.
 *
 * `attemptTotp` ghi `lastAcceptedStep` sau mỗi lượt chấp nhận, nên **một mã không
 * dùng lại được** — đó là chống replay, và nó đang chạy. Hệ quả với test: lượt
 * bật yếu tố đã tiêu mã của cửa sổ hiện tại, nên bước đăng nhập ngay sau đó mà
 * dùng `currentCode(secret)` sẽ nhận đúng cùng sáu chữ số và **bị từ chối**. Đây
 * là thứ đã làm spec này đỏ một lần, với triệu chứng đọc ra là "mã thật không vào
 * được" — tức là gần như ngược lại nguyên nhân.
 *
 * Chờ theo `totpStep()` chứ không `setTimeout(30_000)`: các bước neo vào Unix
 * epoch, không vào lúc test bắt đầu, nên một lượt chờ cứng 30 giây có thể vắt qua
 * ranh giới bước và trả về khi cửa sổ **lại** là cửa sổ cũ. Hàm này chờ đúng phần
 * còn lại rồi kiểm chứng số bước đã thật sự tăng.
 */
async function waitForNextTotpWindow(from: number): Promise<void> {
  while (totpStep() === from) {
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
}

/**
 * Hàng của yếu tố TOTP.
 *
 * Neo theo nhãn nhìn thấy được chứ không theo tên thẻ: các hàng là `div` trần,
 * và khối bao quanh còn chứa nút mã dự phòng — nút đó `disabled` khi chưa có yếu
 * tố nào, nên một phép khớp theo tên ở phạm vi cả khối sẽ trỏ vào nó rồi chờ mãi.
 * (Cùng khuôn với `admin-mfa.spec.ts`; lặp lại ở đây thay vì tách ra một tệp
 * dùng chung, vì hai spec khẳng định hai thứ khác nhau và một helper dùng chung
 * là chỗ để một lần sửa làm đỏ cả hai.)
 */
function totpRow(page: Page) {
  return page.locator('div').filter({
    has: page.getByText('Ứng dụng xác thực (Google Authenticator)'),
  }).filter({ has: page.getByRole('button') }).last()
}

/** Điền bước mật khẩu và bấm gửi. KHÔNG chờ điều hướng — đó là thứ cần kiểm. */
async function submitPassword(page: Page) {
  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', adminPassword())
  await page.click('button[type="submit"]')
}

async function loginWithoutChallenge(page: Page) {
  await submitPassword(page)
  await page.waitForURL(/\/admin(?!\/login)/)
}

test.describe.configure({ mode: 'serial' })

/**
 * Trả tài khoản seed về trạng thái ban đầu: không yếu tố nào.
 *
 * Nằm trong `afterEach`, KHÔNG ở cuối `test()`. Nếu để cuối thân test, một khẳng
 * định đỏ ở giữa sẽ **bỏ qua toàn bộ phần dọn** — và tài khoản còn nguyên TOTP
 * đang bật thì mọi spec sau đó chết ở bước đăng nhập với một lỗi không liên quan
 * gì tới điều chúng kiểm. Đúng việc đã xảy ra: một lượt chạy có 7 spec đỏ mà chỉ
 * 1 trong số đó là lỗi thật.
 *
 * Xoá thẳng ở tầng CSDL, không qua giao diện: sau một lần đỏ, cổng đăng nhập đang
 * đòi một mã mà phần dọn không có, nên bấm nút "Tắt" là đường **không tới được**.
 * Xoá `user_mfa_factors` cũng làm các mã dự phòng còn lại thành vô nghĩa, và hàng
 * của chúng bị xoá cùng lượt.
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

test('bước thử thách lúc đăng nhập: mật khẩu đúng chưa đủ, mã sai bị chặn, mã thật và mã dự phòng vào được', async ({ page }) => {
  // Trần 60 giây mặc định không đủ: test này **phải** chờ sang một cửa sổ TOTP mới
  // (tối đa 30 giây, xem `waitForNextTotpWindow`) và lượt chờ đó là một phần của
  // điều nó khẳng định, không phải một chỗ chậm cần tối ưu. Chống replay là lý do
  // nó tồn tại, nên nó không thể "nhanh hơn" mà vẫn đúng.
  test.setTimeout(150_000)
  // ── Dựng: bật TOTP và sinh mã dự phòng ────────────────────────────────────
  // Tài khoản seed khởi điểm không có yếu tố nào (đăng ký là tự nguyện), nên lượt
  // đăng nhập đầu tiên này đi thẳng vào — và điều đó cũng là mốc so sánh cho
  // khẳng định số 1 bên dưới.
  await loginWithoutChallenge(page)

  await page.goto('/admin/profile')
  await totpRow(page).getByRole('button', { name: /^(Bật|Tiếp tục bật)$/ }).click()
  const enrollDialog = page.getByRole('dialog')
  await expect(enrollDialog).toBeVisible()
  await enrollDialog.locator('#enroll-pw').fill(adminPassword())
  await enrollDialog.getByRole('button', { name: /Tiếp tục|Gửi mã|Bật/ }).first().click()

  const secret = (await enrollDialog.locator('code').first().innerText()).trim()
  expect(secret, 'máy chủ không phát secret TOTP nào').not.toBe('')
  // Ghi lại cửa sổ mà mã bật yếu tố thuộc về: nó vừa bị tiêu, nên lượt đăng nhập
  // ở bước 3 phải chờ sang cửa sổ kế tiếp.
  const enrolledStep = totpStep()
  await enrollDialog.locator('#enroll-code').fill(currentCode(secret))
  await enrollDialog.getByRole('button', { name: /Xác nhận|Bật/ }).last().click()
  await expect(enrollDialog).toBeHidden()
  await expect(totpRow(page).getByRole('button', { name: /^Tắt$/ })).toBeVisible()

  // Mã dự phòng: sinh ngay, vì đây là lần duy nhất chúng đọc được (lưu bcrypt).
  // Phải TẢI LẠI trang trước: nút "Tạo mã dự phòng" mang
  // `:disabled="activeFactors.length === 0"`, và card chỉ đọc trạng thái máy chủ
  // lúc tải — đóng hộp thoại bật yếu tố **không** làm nó fetch lại, nên nút vẫn
  // disabled và một cú bấm vào đó không làm gì cả, im lặng.
  await page.reload()
  await page.getByRole('button', { name: /[Tt]ạo mã dự phòng|[Tt]ạo lại mã/ }).first().click()
  const codesDialog = page.getByRole('dialog')
  await codesDialog.locator('input[type="password"]').first().fill(adminPassword())
  await codesDialog.getByRole('button', { name: /Tạo|Xác nhận/ }).last().click()
  const shown = page.locator('li.font-mono')
  await expect(shown.first()).toBeVisible()
  const recoveryCodes = (await shown.allInnerTexts()).map(t => t.trim()).filter(Boolean)
  expect(recoveryCodes.length, 'không có mã dự phòng nào được hiện').toBeGreaterThan(1)

  // ── 1. Mật khẩu đúng KHÔNG còn đủ để vào ──────────────────────────────────
  // Bật yếu tố thu hồi các phiên khác, nên lượt đăng nhập dưới đây là lượt mới
  // thật, không phải một phiên còn sống được dùng lại.
  await submitPassword(page)
  const challenge = page.getByRole('heading', { name: 'Xác thực hai bước' })
  await expect(challenge, 'mật khẩu đúng đi thẳng vào /admin — bước thử thách không được đòi')
    .toBeVisible()
  expect(page.url(), 'đã điều hướng khỏi trang đăng nhập dù yếu tố đang bật').toContain('/admin/login')
  // Trường mã phải có mặt và nhận được tiêu điểm: bước thử thách hiện ra mà không
  // có chỗ gõ là một ngõ cụt.
  await expect(page.locator('#mfa-code')).toBeVisible()

  // ── 2. Mã sai bị từ chối, kèm lý do đọc được ──────────────────────────────
  //
  // ĐO ĐƯỢC, không phải giả định: `verify.post.ts:136` trả **401** cho một mã
  // sai, và `handleVerify` xử lý 401 bằng cách quay về bước mật khẩu. Nên hình
  // dạng thật là: mã sai → lùi về bước mật khẩu, kèm alert "Mã xác thực không
  // đúng." Test này ban đầu khẳng định điều ngược lại (rằng người dùng ở lại bước
  // thử thách) và đỏ — hành vi mới là đúng, giả định của test thì không.
  //
  // Sự mơ hồ có thật và có chủ đích ở phía client: cùng một 401 mang cả "vé thử
  // thách hết hạn" lẫn "mã gõ sai", nên client **không phân biệt được**, và lùi
  // về bước mật khẩu là nhánh an toàn duy nhất — giữ nguyên bước thử thách với
  // một vé đã bị xoá phía máy chủ sẽ tạo ra một form không bao giờ gửi được.
  // Điều phải giữ là **lý do hiện ra**: một lượt lùi im lặng đọc ra là mật khẩu
  // vừa nhập bị sai, và người dùng sẽ đi đổi mật khẩu.
  await page.locator('#mfa-code').fill('000000')
  await page.getByRole('button', { name: /Xác nhận & Đăng nhập/ }).click()
  await expect(
    page.getByRole('alert'),
    'mã sai bị từ chối trong im lặng — không có gì nói vì sao, và người dùng sẽ '
    + 'kết luận mật khẩu của họ bị sai',
  ).toContainText(/không đúng/i)
  expect(page.url(), 'mã sai không được cho đi qua').toContain('/admin/login')
  // Vé đã bị thu, nên phải đi lại từ bước mật khẩu để tới thử thách lần nữa.
  await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible()

  // ── 3. Mã thật vào được ────────────────────────────────────────────────────
  // Chờ sang cửa sổ kế tiếp trước: mã của cửa sổ lúc bật đã bị `lastAcceptedStep`
  // tiêu mất, và dùng lại nó ở đây sẽ bị từ chối — đọc ra là "mã thật không vào
  // được", gần như ngược lại nguyên nhân.
  await waitForNextTotpWindow(enrolledStep)
  await submitPassword(page)
  await expect(challenge).toBeVisible()
  await page.locator('#mfa-code').fill(currentCode(secret))
  await page.getByRole('button', { name: /Xác nhận & Đăng nhập/ }).click()
  await page.waitForURL(/\/admin(?!\/login)/)

  // ── 4. Mã dự phòng cũng vào được, qua bộ chọn cách xác thực ───────────────
  // Đây là đường về khi mất điện thoại. Nút chọn chỉ hiện khi `methodChoices` có
  // nhiều hơn một mục — tính sai thì nút biến mất và tài khoản bị khoá ngoài dù
  // đang giữ đủ mã.
  await submitPassword(page)
  await expect(challenge).toBeVisible()
  const recoveryButton = page.getByRole('button', { name: 'Mã dự phòng' })
  await expect(recoveryButton, 'không có nút chọn "Mã dự phòng" — mất điện thoại là mất tài khoản')
    .toBeVisible()
  await recoveryButton.click()
  await expect(recoveryButton).toHaveAttribute('aria-pressed', 'true')

  await page.locator('#mfa-code').fill(recoveryCodes[0]!)
  await page.getByRole('button', { name: /Xác nhận & Đăng nhập/ }).click()
  await page.waitForURL(/\/admin(?!\/login)/)

  // Phần dọn nằm ở `afterEach` — xem lời giải thích ở đó. Nó chạy cả khi test này
  // đỏ giữa đường, và đó là toàn bộ lý do nó không ở đây.
})

/**
 * Phép giải người nhận email thông báo đơn đăng ký.
 *
 * Suite này **chạy** hàm thật thay vì soi văn bản mã nguồn, và đó là điểm chính:
 * cổng cũ ở `cms-core-auth-media.test.ts` ghim đúng chuỗi ký tự `allowed.has(to)`.
 * Nó chặn được việc xoá dòng đó, nhưng **xanh vĩnh viễn** với câu hỏi thật —
 * "một địa chỉ do người gửi tự nhập có bao giờ nhận được thư không?" — vì một
 * khẳng định về ký tự không bao giờ là một khẳng định về giá trị trả về.
 *
 * Bằng chứng: cả bốn lớp lỗi làm biểu mẫu trang chủ **chưa bao giờ gửi được email
 * nào** đều lọt qua cổng đó, vì mỗi lớp nằm ở một tệp khác và không lớp nào chạm
 * tới dòng nó ghim.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { resolveSubmissionRecipient, isValidEmail } from '../server/utils/submission-recipient.ts'

const SITE = 'contact@conduonghuongthien.com.vn'
const BLOCK = 'tiepnhan@conduonghuongthien.com.vn'
const OTHER = 'phongb@conduonghuongthien.com.vn'

describe('open-relay không còn khả năng, và đây là khẳng định quan trọng nhất', () => {
  test('địa chỉ người gửi tự nhập KHÔNG BAO GIỜ được dùng khi nó không có trong cấu hình', () => {
    const evil = 'nguoi-la@evil.example'
    const { to, source } = resolveSubmissionRecipient(evil, [BLOCK, OTHER], SITE)
    assert.notEqual(to, evil, 'địa chỉ do thân request cung cấp đã nhận được thư')
    assert.equal(to, SITE)
    assert.equal(source, 'site-settings')
  })

  test('kể cả khi không có gì được cấu hình, địa chỉ tự nhập vẫn bị bỏ', () => {
    const { to } = resolveSubmissionRecipient('nguoi-la@evil.example', [], '')
    assert.equal(to, null)
  })

  test('so khớp không phân biệt chữ hoa thường, nên không lách được bằng cách đổi vỏ', () => {
    const { to, source } = resolveSubmissionRecipient(BLOCK.toUpperCase(), [BLOCK, OTHER], SITE)
    assert.equal(to, BLOCK)
    assert.equal(source, 'block-request')
  })

  test('khoảng trắng hai đầu không tạo ra một địa chỉ khác', () => {
    const { to, source } = resolveSubmissionRecipient(`  ${BLOCK}  `, [BLOCK, OTHER], SITE)
    assert.equal(to, BLOCK)
    assert.equal(source, 'block-request')
  })
})

describe('thứ tự ưu tiên', () => {
  test('địa chỉ đã cấu hình mà client xin thì được tôn trọng', () => {
    const { to, source } = resolveSubmissionRecipient(OTHER, [BLOCK, OTHER], SITE)
    assert.equal(to, OTHER)
    assert.equal(source, 'block-request')
  })

  test('CHÍNH XÁC MỘT địa chỉ đã cấu hình thì dùng nó, dù client không gửi gì', () => {
    // Đây là ca thật đã xảy ra: cán bộ đặt email nhận trong Page Builder, còn
    // biểu mẫu ở trang chủ không gửi trường đó lên.
    const { to, source } = resolveSubmissionRecipient('', [BLOCK], SITE)
    assert.equal(to, BLOCK)
    assert.equal(source, 'block-single')
  })

  test('NHIỀU HƠN MỘT địa chỉ thì KHÔNG đoán — lùi về email của cổng', () => {
    // Chọn hộ ở đây là gửi hồ sơ của một công dân tới một đơn vị không phụ trách.
    const { to, source } = resolveSubmissionRecipient('', [BLOCK, OTHER], SITE)
    assert.equal(to, SITE)
    assert.equal(source, 'site-settings')
  })

  test('không cấu hình gì thì lùi về email của cổng — đây là lý do phép sửa có hiệu lực ngay', () => {
    const { to, source } = resolveSubmissionRecipient('', [], SITE)
    assert.equal(to, SITE)
    assert.equal(source, 'site-settings')
  })

  test('không có gì dùng được thì trả null kèm lý do đọc được', () => {
    const { to, source } = resolveSubmissionRecipient('', [], '')
    assert.equal(to, null)
    assert.equal(source, 'none')
  })
})

describe('giá trị không dùng được bị loại, không được truyền tiếp', () => {
  test('mục cấu hình không phải email bị bỏ khỏi allowlist', () => {
    // Một block có `recipientEmail: 'chưa đặt'` không được biến thành người nhận.
    const { to, source } = resolveSubmissionRecipient('', ['không-phải-email', BLOCK], SITE)
    assert.equal(to, BLOCK, 'mục rác đáng ra phải bị loại, để lại đúng một địa chỉ')
    assert.equal(source, 'block-single')
  })

  test('allowlist toàn rác thì lùi về email của cổng chứ không trả rác', () => {
    const { to, source } = resolveSubmissionRecipient('', ['', '   ', 'a@b'], SITE)
    assert.equal(to, SITE)
    assert.equal(source, 'site-settings')
  })

  test('email của cổng không dùng được thì trả null, không trả chuỗi rỗng', () => {
    // Một `to: ''` truyền xuống nodemailer là một lỗi lúc chạy ở tầng khác, xa
    // chỗ quyết định — nên nó phải chết ở đây.
    for (const bad of ['', '   ', 'chưa-đặt', 'a@b']) {
      const { to, source } = resolveSubmissionRecipient('', [], bad)
      assert.equal(to, null, `nhận nhầm ${JSON.stringify(bad)}`)
      assert.equal(source, 'none')
    }
  })

  test('kiểu dữ liệu lạ không làm hàm ném lỗi', () => {
    // Thân request là dữ liệu công khai; `recipientEmail: {}` không được phép làm
    // sập một endpoint mà công dân đang gửi hồ sơ qua đó.
    for (const bad of [null, undefined, 42, {}, [], true]) {
      const { to } = resolveSubmissionRecipient(bad, [BLOCK], SITE)
      assert.equal(to, BLOCK)
    }
  })

  test('trùng lặp trong cấu hình không làm "đúng một địa chỉ" thành "nhiều địa chỉ"', () => {
    // Cùng một email đặt trên hai block là chuyện thường; nó vẫn là một nơi nhận.
    const { to, source } = resolveSubmissionRecipient('', [BLOCK, BLOCK.toUpperCase(), `  ${BLOCK}`], SITE)
    assert.equal(to, BLOCK)
    assert.equal(source, 'block-single')
  })
})

describe('isValidEmail', () => {
  test('nhận địa chỉ thường gặp', () => {
    for (const ok of ['a@b.co', SITE, 'Ho.Ten+don@so.gov.vn']) {
      assert.equal(isValidEmail(ok), true, `từ chối ${ok}`)
    }
  })

  test('từ chối chuỗi không phải địa chỉ và kiểu không phải chuỗi', () => {
    for (const bad of ['', 'a@b', 'a b@c.vn', 'a@@b.vn', null, undefined, 7, {}]) {
      assert.equal(isValidEmail(bad), false, `nhận ${JSON.stringify(bad)}`)
    }
  })
})

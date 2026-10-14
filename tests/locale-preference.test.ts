/**
 * Phần thuần của lựa chọn ngôn ngữ (`app/utils/locale-preference.ts`).
 *
 * Hành vi đầu-cuối — máy chủ không ghi `set-cookie: cdkt_lang`, khách giữ được
 * ngôn ngữ qua các trang cache, đổi ngôn ngữ sau hydrate không lệch — được
 * chứng minh bằng trình duyệt thật ở `tests/e2e/public-language-cache.spec.ts`.
 * Ở đây khoá những quyết định nhỏ mà spec đó dựa vào: đọc cookie, thứ tự ưu
 * tiên localStorage → cookie, và việc giá trị lạ không bao giờ lọt vào chuỗi
 * cookie hay đường dẫn API bản dịch.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_MAX_AGE,
  localeFromCookieHeader,
  normalizeLocale,
  parseLocale,
  resolvePreferredLocale,
  serializeLocaleCookie,
} from '../app/utils/locale-preference'

test('parseLocale nhận mã ngôn ngữ, chuẩn hoá chữ thường, bỏ khoảng trắng', () => {
  assert.equal(parseLocale('en'), 'en')
  assert.equal(parseLocale(' EN '), 'en')
  assert.equal(parseLocale('zh-CN'), 'zh-cn')
  assert.equal(parseLocale('zh_CN'), 'zh_cn')
  assert.equal(parseLocale('fil'), 'fil')
})

test('parseLocale coi giá trị rỗng, sai kiểu hoặc chứa ký tự lạ là "chưa chọn"', () => {
  for (const value of [undefined, null, '', '   ', 42, {}, 'e', 'english', 'en;domain=evil', 'en/../../x', '../vi', 'en vi', 'vi\n']) {
    assert.equal(parseLocale(value), value === 'vi\n' ? 'vi' : null, `giá trị ${JSON.stringify(value)}`)
  }
})

test('normalizeLocale lùi về tiếng Việt khi không có lựa chọn hợp lệ', () => {
  assert.equal(DEFAULT_LOCALE, 'vi')
  assert.equal(normalizeLocale(undefined), 'vi')
  assert.equal(normalizeLocale('en;x'), 'vi')
  assert.equal(normalizeLocale('FR'), 'fr')
})

test('localeFromCookieHeader đọc đúng cookie cdkt_lang giữa các cookie khác', () => {
  assert.equal(localeFromCookieHeader('cdkt_lang=en'), 'en')
  assert.equal(localeFromCookieHeader('a=1; cdkt_lang=ru; cdkt_admin=xyz'), 'ru')
  assert.equal(localeFromCookieHeader('x_cdkt_lang=en; cdkt_lang_old=fr'), null, 'tên cookie phải khớp tuyệt đối')
  assert.equal(localeFromCookieHeader('cdkt_lang=zh%2Dcn'), 'zh-cn', 'giá trị được decodeURIComponent')
  assert.equal(localeFromCookieHeader('cdkt_lang=%E0%A4%A'), null, 'mã hoá hỏng không làm ném lỗi')
  assert.equal(localeFromCookieHeader('cdkt_lang='), null)
  assert.equal(localeFromCookieHeader(''), null)
  assert.equal(localeFromCookieHeader(null), null)
  assert.equal(localeFromCookieHeader(undefined), null)
})

test('resolvePreferredLocale: localStorage là nguồn chân lý, cookie là dự phòng, không có thì null', () => {
  assert.equal(resolvePreferredLocale('en', 'fr'), 'en')
  assert.equal(resolvePreferredLocale(null, 'fr'), 'fr', 'khách chỉ còn cookie vẫn giữ lựa chọn')
  assert.equal(resolvePreferredLocale('garbage value', 'fr'), 'fr', 'localStorage hỏng không xoá lựa chọn trong cookie')
  assert.equal(resolvePreferredLocale(null, null), null, 'chưa từng chọn → không ghi gì, giữ tiếng Việt')
})

test('serializeLocaleCookie sinh cookie một năm, path=/, SameSite=Lax và không thể bị chèn thuộc tính', () => {
  assert.equal(serializeLocaleCookie('en'), `cdkt_lang=en; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`)
  assert.equal(LOCALE_COOKIE_MAX_AGE, 31_536_000)
  assert.match(serializeLocaleCookie('en; domain=evil.example'), /^cdkt_lang=vi; path=\/;/, 'giá trị lạ lùi về vi, không chèn được thuộc tính')
  // Vòng tròn: thứ ghi ra đọc lại được đúng như cũ.
  for (const code of ['vi', 'en', 'zh-cn', 'lo']) {
    assert.equal(localeFromCookieHeader(serializeLocaleCookie(code).split(';')[0]), code)
  }
})

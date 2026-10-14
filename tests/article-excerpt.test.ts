/**
 * `cleanExcerpt` — một bản duy nhất thay cho 4 bản chép (news, role-models,
 * reintegration-models, ContentTypeListSection) giải mã các tập thực thể khác nhau.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanExcerpt } from '../app/utils/article-excerpt'

test('rỗng / null / undefined → chuỗi rỗng', () => {
  assert.equal(cleanExcerpt(null), '')
  assert.equal(cleanExcerpt(undefined), '')
  assert.equal(cleanExcerpt(''), '')
})

test('bóc thẻ HTML và gộp khoảng trắng', () => {
  assert.equal(cleanExcerpt('<p>Xin <strong>chào</strong></p>\n<p>bạn</p>'), 'Xin chào bạn')
})

test('thực thể tiếng Việt có tên (TinyMCE) được giải mã', () => {
  assert.equal(cleanExcerpt('Ng&agrave;y h&ocirc;m nay, C&ocirc;ng an'), 'Ngày hôm nay, Công an')
  assert.equal(cleanExcerpt('&Dstrok;&agrave; N&abreve;ng &dstrok;&utilde;'), 'Đà Năng đũ')
})

test('dấu ngoặc kép kiểu chữ, ba chấm, gạch nối và &amp;', () => {
  assert.equal(cleanExcerpt('&ldquo;Tái hòa nhập&rdquo; &hellip; A &amp; B &ndash; C'), '“Tái hòa nhập” … A & B – C')
  assert.equal(cleanExcerpt('&lsquo;x&rsquo; &laquo;y&raquo;'), '‘x’ «y»')
})

test('thực thể số thập phân và thập lục phân, kể cả ngoài BMP', () => {
  assert.equal(cleanExcerpt('&#273;&#7889;i &#x111;&#X1ED1;i'), 'đối đối')
  assert.equal(cleanExcerpt('&#128512;'), '\u{1F600}')
})

test('&nbsp; và &#160; thành khoảng trắng thường rồi được gộp', () => {
  assert.equal(cleanExcerpt('a&nbsp;&nbsp;b&#160;c'), 'a b c')
})

test('giải mã đúng MỘT lượt: chữ "&#60;" tác giả gõ (lưu là &amp;#60;) không thành "<"', () => {
  assert.equal(cleanExcerpt('&amp;#60;'), '&#60;')
  assert.equal(cleanExcerpt('&amp;lt;'), '&lt;')
})

test('điểm mã ngoài khoảng không ném lỗi (sẽ làm hỏng lượt dựng SSR) mà thành U+FFFD', () => {
  assert.doesNotThrow(() => cleanExcerpt('&#99999999;'))
  assert.equal(cleanExcerpt('a&#99999999;b'), 'a�b')
  assert.equal(cleanExcerpt('&#xD800;'), '�')
  assert.equal(cleanExcerpt('&#0;'), '�')
  assert.equal(cleanExcerpt('&#99999999999999999999999;'), '�')
})

test('thực thể lạ giữ nguyên, không đoán bừa', () => {
  assert.equal(cleanExcerpt('&unknownthing; &amp'), '&unknownthing; &amp')
})

test('kết quả là văn bản: thẻ được mã hoá thành chữ, hiển thị qua {{ }} nên vô hại', () => {
  assert.equal(cleanExcerpt('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>')
})

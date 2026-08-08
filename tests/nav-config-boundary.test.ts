/**
 * Cấu hình điều hướng do quản trị viên nhập là BIÊN TIN CẬY, không chỉ là JSON.
 *
 * Chuỗi này lưu ở cột `settings` (nhập tại `/admin/content/navigation/*`) rồi đi
 * thẳng vào `v-for` dựng thanh điều hướng của **mọi trang công khai**. Bản cũ
 * trong `<script setup>` của `default.vue` chỉ có
 * `try { JSON.parse(raw) } catch { return null }` — bắt được JSON hỏng cú pháp,
 * **không** bắt được JSON hợp lệ mang hình dạng sai.
 *
 * Đó là khoảng trống có hậu quả nhìn thấy được: `[{}]` là JSON hợp lệ, nên nó đi
 * qua, rồi `item.url` là `undefined` và `<NuxtLink :to="undefined">` cho ra một
 * liên kết không dẫn tới đâu. Một mảng rỗng thì tệ hơn — thanh điều hướng **biến
 * mất trên toàn cổng**. Cả hai xảy ra sau một lượt lưu **thành công**, nên không
 * có gì chỉ vào nguyên nhân.
 *
 * Quy tắc bao trùm được kiểm ở đây: **mọi** dữ liệu không dùng được đều ra `null`
 * để nơi gọi lùi về bảng mặc định. Cấu hình sai nên làm cổng trông như *chưa*
 * cấu hình, không nên làm cổng trông như *bị hỏng*.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  DEFAULT_BOTTOM_NAV,
  DEFAULT_NAV,
  parseBottomNavConfig,
  parseNavConfig,
} from '../app/utils/nav-config.ts'

describe('parseNavConfig — mọi đầu vào không dùng được ra null', () => {
  /**
   * Từng dạng một, để khi test đỏ thì thông báo chỉ thẳng vào dạng đã lọt.
   * Bốn dạng đầu bản cũ **đã** chặn (JSON hỏng); phần còn lại thì không.
   */
  const MUST_BE_NULL: Array<[string, unknown]> = [
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['JSON hỏng cú pháp', '{['],
    ['không phải chuỗi', 42],
    ['null', null],
    ['undefined', undefined],
    ['JSON hợp lệ nhưng là object', '{"id":"home"}'],
    ['JSON hợp lệ nhưng là số', '5'],
    ['JSON hợp lệ nhưng là chuỗi', '"home"'],
    ['mảng rỗng', '[]'],
    ['mảng object rỗng', '[{}]'],
    ['thiếu url', '[{"id":"home"}]'],
    ['thiếu id', '[{"url":"/"}]'],
    ['url rỗng', '[{"id":"home","url":"   "}]'],
    ['mảng toàn phần tử không phải object', '[1,2,"a",null]'],
    ['mảng lồng mảng', '[[{"id":"a","url":"/"}]]'],
  ]

  for (const [label, raw] of MUST_BE_NULL) {
    it(`${label} → null (lùi về bảng mặc định)`, () => {
      assert.equal(parseNavConfig(raw), null,
        `${label} lọt vào thanh điều hướng của mọi trang công khai`)
    })
  }

  it('nhận cấu hình dùng được', () => {
    const items = parseNavConfig('[{"id":"home","url":"/","label":"Trang chủ"}]')
    assert.deepEqual(items, [{ id: 'home', label: 'Trang chủ', url: '/', children: [] }])
  })

  /** `label: null` là cách khai "dùng labelKey để dịch", không phải thiếu dữ liệu. */
  it('label null vẫn dùng được khi có labelKey', () => {
    const items = parseNavConfig('[{"id":"home","url":"/","label":null,"labelKey":"home"}]')
    assert.equal(items![0]!.label, null)
    assert.equal(items![0]!.labelKey, 'home')
  })

  it('bỏ mục hỏng, giữ mục dùng được', () => {
    const items = parseNavConfig('[{"id":"a","url":"/a"},{},{"id":"b"},{"id":"c","url":"/c"}]')
    assert.deepEqual(items!.map(i => i.id), ['a', 'c'],
      'một mục hỏng không được kéo cả thanh điều hướng xuống')
  })

  it('bỏ mục con hỏng nhưng giữ mục cha', () => {
    const items = parseNavConfig('[{"id":"news","url":"/news","children":[{"id":"x","url":"/x"},{}]}]')
    assert.deepEqual(items![0]!.children!.map(c => c.id), ['x'])
  })

  /**
   * Đúng MỘT cấp con. Thanh nav chỉ vẽ được một tầng dropdown, nên một cây sâu
   * hơn không phải cấu hình phong phú — nó là những mục **không bao giờ hiện ra**,
   * và cán bộ lưu xong sẽ đi tìm vì sao chúng biến mất.
   */
  it('cắt cấp con thứ hai thay vì giữ mục sẽ không bao giờ hiện', () => {
    const items = parseNavConfig(
      '[{"id":"a","url":"/a","children":[{"id":"b","url":"/b","children":[{"id":"c","url":"/c"}]}]}]')
    assert.deepEqual(items![0]!.children![0]!.children, [],
      'cấp thứ ba không có chỗ vẽ, nên nó không được lưu lại như thể có')
  })

  it('bảng mặc định tự nó dùng được', () => {
    for (const item of DEFAULT_NAV) {
      assert.ok(item.id, 'mọi mục mặc định phải có id (dùng làm :key của v-for)')
      assert.ok(item.url, 'mọi mục mặc định phải có url')
    }
  })

  /**
   * `openNewTab` phải sống sót qua bộ khử độc — nó ĐÃ TỪNG không.
   *
   * Cán bộ tick ô "Mở tab mới", `navigation.put.ts` lưu đúng trường đó, rồi
   * `normalizeNavItem` dựng lại node từng trường và **không copy nó**. Kết quả là
   * trang công khai bỏ qua thiết lập sau một lượt lưu *thành công*, với ô vẫn còn
   * tick khi tải lại — không có triệu chứng nào chỉ vào nguyên nhân.
   *
   * Hồi quy này đến từ việc đổi `JSON.parse` passthrough (giữ mọi trường, kể cả
   * trường nó không biết) sang một bộ khử độc allowlist (chỉ giữ trường được nêu
   * tên). Bộ khử độc đúng hơn — đó là lý do nó tồn tại — nhưng nó **im lặng** với
   * trường bị quên, nên chỗ duy nhất phát hiện được là một test như thế này.
   */
  it('giữ openNewTab ở cả mục cha và mục con', () => {
    const items = parseNavConfig(JSON.stringify([{
      id: 'ext', label: 'Cổng Bộ Công an', url: 'https://bocongan.gov.vn', openNewTab: true,
      children: [{ id: 'ext-vb', label: 'Văn bản', url: 'https://bocongan.gov.vn/vb', openNewTab: true }],
    }]))
    assert.equal(items![0]!.openNewTab, true,
      'ô "Mở tab mới" của mục cha bị bộ khử độc bỏ qua — cán bộ lưu thành công mà cổng không đổi gì')
    assert.equal(items![0]!.children![0]!.openNewTab, true,
      'mục con đi qua cùng hàm, nên nó phải giữ cờ này y như mục cha')
  })

  /**
   * Vắng mặt và `false` phải cho ra **cùng một** kết quả dùng được.
   *
   * Template đọc cờ này bằng một phép kiểm truthy, nên `undefined` và `false` hành
   * xử giống nhau — nhưng chỉ khi giá trị không dùng được không lọt qua thành
   * truthy. `"false"` là chuỗi, và chuỗi nào cũng truthy: đọc bằng `Boolean(...)`
   * sẽ **bật** cờ mà cán bộ vừa tắt, nếu một đường ghi nào đó (hay một lượt sửa
   * tay trong CSDL) từng lưu nó dưới dạng chuỗi.
   */
  it('chỉ boolean true bật cờ — chuỗi "false" không được lọt qua', () => {
    const notEnabled: Array<[string, unknown]> = [
      ['vắng mặt', undefined],
      ['false', false],
      ['chuỗi "false"', 'false'],
      ['chuỗi "true"', 'true'],
      ['số 1', 1],
      ['null', null],
    ]
    for (const [label, value] of notEnabled) {
      const raw = JSON.stringify([{ id: 'a', label: 'A', url: 'https://x.vn', openNewTab: value }])
      assert.notEqual(parseNavConfig(raw)![0]!.openNewTab, true,
        `openNewTab: ${label} không được đọc thành "bật" — nó sẽ mở tab mới trái ý cán bộ`)
    }
  })
})

/**
 * `target="_blank"` phải LUÔN đi kèm `rel="noopener noreferrer"`.
 *
 * Không có `noopener`, trang được mở giữ được `window.opener` và **ghi được** vào
 * `location` của cổng — tức là một liên kết ngoài do cán bộ cấu hình có thể bị
 * trang đích chuyển hướng sang một bản sao giả mạo của chính cổng này. Trên cổng
 * của cơ quan nhà nước, đó là đúng loại chuyển hướng mà người đọc không có cách
 * nào phát hiện.
 *
 * Kiểm ở đây, cùng chỗ với bộ đọc `openNewTab`, vì cờ đó chính là thứ **bật**
 * `target="_blank"` lên: hai thứ này chỉ đúng khi đi cùng nhau, nên chúng được
 * kiểm cùng nhau.
 */
describe('template nav — target="_blank" không bao giờ đứng một mình', () => {
  it('mọi chỗ đặt target _blank đều đặt kèm rel noopener', () => {
    const layout = readFileSync(
      new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
    const bindings = layout.match(/openNewTab \? '_blank'[^"]*/g) ?? []
    assert.ok(bindings.length >= 4,
      `tìm thấy ${bindings.length} chỗ dùng openNewTab để đặt target; nav có 4 (cha/con × desktop/mobile) — ` +
      'ít hơn nghĩa là một bề mặt đã ngừng đọc cờ này')
    for (const binding of bindings) {
      assert.match(binding, /rel:/,
        `một chỗ đặt target="_blank" mà không có rel kèm theo: ${binding}`)
    }
    for (const match of layout.matchAll(/rel: [^,}]*openNewTab[^,}]*/g)) {
      assert.match(match[0], /noopener/,
        `rel thiếu noopener — trang đích ghi được vào location của cổng: ${match[0]}`)
    }
  })
})

describe('parseBottomNavConfig', () => {
  const MUST_BE_NULL: Array<[string, unknown]> = [
    ['chuỗi rỗng', ''],
    ['JSON hỏng', '{['],
    ['không phải mảng', '{"id":"home"}'],
    ['mảng rỗng', '[]'],
    ['thiếu type', '[{"id":"home","url":"/"}]'],
    ['type lạ', '[{"id":"home","type":"popup","url":"/"}]'],
    ['type link nhưng thiếu url', '[{"id":"home","type":"link"}]'],
    ['thiếu id', '[{"type":"link","url":"/"}]'],
  ]

  for (const [label, raw] of MUST_BE_NULL) {
    it(`${label} → null`, () => {
      assert.equal(parseBottomNavConfig(raw), null,
        `${label} lọt vào thanh tab dưới trên điện thoại`)
    })
  }

  /**
   * `type` lạ là kiểu hỏng đặc trưng của thanh này: template phân nhánh theo nó,
   * nên một giá trị không khớp cho ra một tab **bấm không có tác dụng gì** — nó
   * vẫn hiện, vẫn có icon, và im lặng.
   */
  it('type chatbot và drawer không cần url', () => {
    const items = parseBottomNavConfig(
      '[{"id":"chat","type":"chatbot","url":""},{"id":"more","type":"drawer"}]')
    assert.deepEqual(items!.map(i => i.type), ['chatbot', 'drawer'])
    assert.deepEqual(items!.map(i => i.url), ['', ''])
  })

  it('icon thiếu thì dùng icon mặc định, không để rỗng', () => {
    const items = parseBottomNavConfig('[{"id":"home","type":"link","url":"/"}]')
    assert.equal(items![0]!.icon, 'fa-solid fa-circle',
      'một tab không icon là một ô trống bấm được — người dùng không biết nó là gì')
  })

  it('featured chỉ nhận true tường minh', () => {
    const truthy = parseBottomNavConfig('[{"id":"a","type":"link","url":"/","featured":"yes"}]')
    assert.equal(truthy![0]!.featured, false,
      'chuỗi "yes" không được đọc thành true — tab nổi là một quyết định thiết kế')
    const real = parseBottomNavConfig('[{"id":"a","type":"link","url":"/","featured":true}]')
    assert.equal(real![0]!.featured, true)
  })

  it('bảng mặc định tự nó dùng được', () => {
    for (const item of DEFAULT_BOTTOM_NAV) {
      assert.ok(item.id)
      assert.ok(item.icon, 'mọi tab mặc định phải có icon')
      assert.ok(['link', 'chatbot', 'drawer'].includes(item.type))
      if (item.type === 'link') assert.ok(item.url, 'tab kiểu link phải có url')
    }
  })

  /** Đúng một tab nổi: hai tab nổi là hai thứ cùng đòi chú ý, tức không có gì nổi. */
  it('bảng mặc định có đúng một tab nổi', () => {
    assert.equal(DEFAULT_BOTTOM_NAV.filter(i => i.featured).length, 1)
  })
})

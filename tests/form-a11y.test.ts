import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { autocompleteFor, controlId, errorId, leadContactInvalid, leadFieldId, validateFormField } from '../app/utils/form-a11y'
import { renderSfcTemplate } from './_render-sfc-template'
import { chatSurfaceSource } from './_component-family.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

describe('form-a11y — id và autocomplete', () => {
  it('id điều khiển/lỗi khác nhau giữa hai thể hiện và giữa các trường', () => {
    assert.notEqual(controlId('v-1', 0), controlId('v-2', 0))
    assert.notEqual(controlId('v-1', 0), controlId('v-1', 1))
    assert.notEqual(controlId('v-1', 0), errorId('v-1', 0))
    assert.equal(errorId('v-1', 3), `${controlId('v-1', 3)}-err`)
  })

  it('leadFieldId: duy nhất theo tin nhắn + trường, luôn là id hợp lệ (không khoảng trắng)', () => {
    const ids = new Set([
      leadFieldId('u', 'm1', 'name'), leadFieldId('u', 'm1', 'phone'), leadFieldId('u', 'm2', 'name'),
      leadFieldId('u', 'm1', 'error'), leadFieldId('u2', 'm1', 'name'),
    ])
    assert.equal(ids.size, 5)
    assert.doesNotMatch(leadFieldId('u', 'a b/c"d', 'email'), /[\s"'/]/)
  })

  it('autocomplete theo map rồi theo kiểu; address cố ý để trống', () => {
    assert.equal(autocompleteFor('name', 'text'), 'name')
    assert.equal(autocompleteFor('phone', 'text'), 'tel')
    assert.equal(autocompleteFor('email', 'text'), 'email')
    assert.equal(autocompleteFor('none', 'tel'), 'tel')
    assert.equal(autocompleteFor(undefined, 'email'), 'email')
    assert.equal(autocompleteFor('address', 'text'), undefined)
    assert.equal(autocompleteFor('message', 'textarea'), undefined)
  })

  it('leadContactInvalid: chỉ đánh dấu khi lỗi và cả hai ô liên hệ đều trống', () => {
    assert.equal(leadContactInvalid({ error: 'x', phone: '', email: '  ' }), true)
    assert.equal(leadContactInvalid({ error: 'x', phone: '0903', email: '' }), false, 'lỗi máy chủ, không phải lỗi ô')
    assert.equal(leadContactInvalid({ error: '', phone: '', email: '' }), false)
    assert.equal(leadContactInvalid(null), false)
    assert.equal(leadContactInvalid(undefined), false)
  })
})

describe('ContactFormBlock — nhãn/lỗi gắn với điều khiển (SSR thật của template)', () => {
  const file = path.join(root, 'app/components/blocks/ContactFormBlock.vue')
  const fields = [
    { id: 'f name', label: 'Họ và tên', type: 'text', required: true, placeholder: '', map: 'name', optionsText: '' },
    { id: 'f_phone', label: 'Số điện thoại', type: 'tel', required: true, placeholder: '', map: 'phone', optionsText: '' },
    { id: 'f_msg', label: 'Nội dung', type: 'textarea', required: false, placeholder: '', map: 'message', optionsText: '' },
    { id: 'f_sel', label: 'Chọn', type: 'select', required: true, placeholder: '', map: 'none', optionsText: 'A\nB' },
  ]
  const state = (uid: string, errors: Record<string, string>) => ({
    uid, controlId, errorId, autocompleteFor,
    hasInfo: false, d: { title: 'Đăng ký' }, infoRows: [], currentLang: 'vi', t: (k: string) => k,
    renderFields: fields, values: {}, errors, submitForm() {}, submitStatus: null, submitMessage: '',
    selectOptions: (f: { optionsText: string }) => f.optionsText.split('\n'), inputType: (t: string) => (t === 'tel' ? 'tel' : 'text'),
  })

  const controls = (html: string) => [...html.matchAll(/<(input|textarea|select)\b([^>]*)>/g)].map((m) => ({ tag: m[1], attrs: m[2] ?? '' }))
  const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]

  it('mỗi <label for> trỏ đúng một điều khiển có id; id không dùng field.id (có khoảng trắng)', async () => {
    const html = await renderSfcTemplate(file, state('v-a', {}))
    const labelFors = [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1])
    const ids = controls(html).map((c) => attr(c.attrs, 'id'))
    assert.equal(labelFors.length, fields.length)
    assert.deepEqual(labelFors, ids)
    for (const id of ids) assert.doesNotMatch(String(id), /\s/)
  })

  it('hai block cùng trang không trùng id', async () => {
    const a = await renderSfcTemplate(file, state('v-a', {}))
    const b = await renderSfcTemplate(file, state('v-b', {}))
    // `tro-giup` là neo cố định của <section> (HeroBlock liên kết `#tro-giup`), không
    // phải id điều khiển: nó trùng khi một trang có hai form — giới hạn đã biết, xem
    // báo cáo. Hợp đồng ở đây là id của NHÃN/ĐIỀU KHIỂN/LỖI.
    const idsOf = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'tro-giup'))
    const shared = [...idsOf(a)].filter((id) => idsOf(b).has(id))
    assert.deepEqual(shared, [])
  })

  it('trường lỗi: aria-invalid + aria-describedby → <p> lỗi đúng id; trường khác không bị đánh dấu', async () => {
    const html = await renderSfcTemplate(file, state('v-a', { f_phone: 'Số điện thoại không hợp lệ' }))
    const cs = controls(html)
    const phone = cs[1]!
    assert.equal(attr(phone.attrs, 'aria-invalid'), 'true')
    const describedBy = attr(phone.attrs, 'aria-describedby')
    assert.equal(describedBy, errorId('v-a', 1))
    // Không `role="alert"` ở từng trường (xem test "MỘT thông báo tóm tắt" bên dưới).
    assert.match(html, new RegExp(`<p id="${describedBy}" class="[^"]*">Số điện thoại không hợp lệ</p>`))
    for (const i of [0, 2, 3]) {
      assert.equal(attr(cs[i]!.attrs, 'aria-invalid'), undefined, `trường ${i} không lỗi`)
      assert.equal(attr(cs[i]!.attrs, 'aria-describedby'), undefined)
    }
  })

  it('viền lỗi đạt tương phản: #b71c1c (6.57:1 trên trắng), không còn #f5c6cb (1.52:1)', async () => {
    const html = await renderSfcTemplate(file, state('v-a', { f_phone: 'lỗi' }))
    assert.match(html, /class="[^"]*border-\[#b71c1c\]/)
    assert.doesNotMatch(html, /border-\[#f5c6cb\]/)
    assert.doesNotMatch(read('app/components/blocks/ContactFormBlock.vue'), /:class="errors\[field\.id\] \? 'border-\[#f5c6cb\]'/)
  })

  it('bắt buộc được công bố bằng aria-required (không dùng required native vì validate riêng); autocomplete theo map', async () => {
    const html = await renderSfcTemplate(file, state('v-a', {}))
    const cs = controls(html)
    assert.equal(attr(cs[0]!.attrs, 'aria-required'), 'true')
    assert.equal(attr(cs[2]!.attrs, 'aria-required'), undefined, 'trường không bắt buộc')
    assert.equal(attr(cs[0]!.attrs, 'autocomplete'), 'name')
    assert.equal(attr(cs[1]!.attrs, 'autocomplete'), 'tel')
    assert.doesNotMatch(html, /\srequired[\s=>]/)
  })

  it('gửi sai nhiều trường → đúng MỘT thông báo role="alert" (tóm tắt), không phải một cái mỗi trường', async () => {
    // Trước đây mỗi dòng lỗi mang role="alert": gửi sai bốn trường là bốn thông báo
    // chen nhau. Giờ: một tóm tắt + focus tới trường lỗi đầu + aria-describedby.
    const errors = { 'f name': 'Bắt buộc', f_phone: 'Sai', f_sel: 'Bắt buộc' }
    const html = await renderSfcTemplate(file, { ...state('v-a', errors), submitStatus: 'error', submitMessage: 'form_validation_check' })
    assert.equal((html.match(/role="alert"/g) ?? []).length, 1)
    assert.match(html, /role="alert"[^>]*>\s*form_validation_check\s*</)
    // Mỗi trường lỗi vẫn trỏ tới dòng lỗi của chính nó.
    const invalid = controls(html).filter((c) => attr(c.attrs, 'aria-invalid') === 'true')
    assert.equal(invalid.length, 3)
    for (const c of invalid) assert.ok(attr(c.attrs, 'aria-describedby'))
  })

  it('sửa trường đang lỗi → kiểm lại ngay khi gõ/rời ô (input + blur; select: change + blur)', () => {
    // STRUCTURAL: hành vi xoá lỗi của chính hàm kiểm có test thuần (validateFormField).
    const source = read('app/components/blocks/ContactFormBlock.vue')
    assert.equal((source.match(/@input="revalidate\(field\)"/g) ?? []).length, 2, 'textarea + input')
    assert.equal((source.match(/@change="revalidate\(field\)"/g) ?? []).length, 1, 'select')
    assert.equal((source.match(/@blur="revalidate\(field\)"/g) ?? []).length, 3)
    assert.match(source, /const revalidate = \(field: RenderField\) => \{\s*if \(!errors\[field\.id\]\) return/)
    assert.match(source, /else delete errors\[field\.id\]/)
  })
})

describe('validateFormField — một quy tắc cho lượt gửi và lượt sửa từng trường', () => {
  const m = { required: 'REQ', email: 'EMAIL', phone: 'PHONE', number: 'NUM' }
  it('bắt buộc mà trống (kể cả chỉ khoảng trắng) → lỗi; không bắt buộc mà trống → hợp lệ', () => {
    assert.equal(validateFormField({ type: 'text', required: true }, '   ', m), 'REQ')
    assert.equal(validateFormField({ type: 'text', required: true }, undefined, m), 'REQ')
    assert.equal(validateFormField({ type: 'email', required: false }, '', m), '')
  })
  it('sai định dạng → lỗi đúng loại; sửa đúng → chuỗi rỗng (aria-invalid được gỡ)', () => {
    assert.equal(validateFormField({ type: 'email', required: true }, 'a@b', m), 'EMAIL')
    assert.equal(validateFormField({ type: 'email', required: true }, 'a@b.vn', m), '')
    assert.equal(validateFormField({ type: 'tel', required: true }, '12', m), 'PHONE')
    assert.equal(validateFormField({ type: 'tel', required: true }, '0903 480 985', m), '')
    assert.equal(validateFormField({ type: 'number', required: false }, '1,5', m), 'NUM')
    assert.equal(validateFormField({ type: 'number', required: false }, '-1.5', m), '')
  })
})

describe('SupportFormBlock — nhãn gắn id/for (SSR thật của template)', () => {
  const file = path.join(root, 'app/components/blocks/SupportFormBlock.vue')
  const render = (uid: string) => renderSfcTemplate(file, {
    uid, d: {}, currentLang: 'vi', t: (k: string) => k, form: { name: '', phone: '', city: '', message: '' },
    submitForm() {}, submitStatus: null, submitMessage: '', PublicEmail: 'span',
  })

  it('mọi ô nhập có <label for> khớp, autocomplete đúng, id khác nhau giữa hai block', async () => {
    const a = await render('s-a')
    const b = await render('s-b')
    const fors = [...a.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1])
    const ids = [...a.matchAll(/<(?:input|textarea)\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1])
    assert.equal(fors.length, 4)
    assert.deepEqual(fors, ids)
    assert.match(a, /type="tel"[^>]*autocomplete="tel"|autocomplete="tel"[^>]*type="tel"/)
    assert.match(a, /autocomplete="name"/)
    const bIds = new Set([...b.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'tro-giup'))
    assert.deepEqual(ids.filter((id) => bIds.has(id)), [])
  })
})

describe('biểu mẫu để-lại-liên-hệ trong chat (kiểm cấu trúc — template cần cả composable chat để mount)', () => {
  // STRUCTURAL: ChatWidget/assistant phụ thuộc useChatbot + hàng chục ref; chỉ kiểm
  // dây nối nhãn/lỗi trong source, phần logic id/invalid đã được test hành vi ở trên.
  // ChatWidget is read as its whole family since its wave3 split (tests/_component-family.ts):
  // the counts below hold for the widget however its markup is divided.
  for (const file of ['app/components/ChatWidget.vue', 'app/pages/assistant.vue']) {
    const source = chatSurfaceSource(file)
    for (const field of ['name', 'phone', 'email', 'question']) {
      it(`${file}: ô "${field}" có <label for> sr-only + id cùng biểu thức`, () => {
        assert.match(source, new RegExp(`<label :for="leadFieldId\\(uid, msg\\.id \\|\\| index, '${field}'\\)" class="sr-only">`))
        assert.match(source, new RegExp(`<(input|textarea) :id="leadFieldId\\(uid, msg\\.id \\|\\| index, '${field}'\\)"`))
      })
    }
    it(`${file}: lỗi là role="alert" có id, ô liên hệ trỏ aria-describedby tới nó và có aria-invalid`, () => {
      assert.match(source, /<p v-if="msg\.lead\.error" :id="leadFieldId\(uid, msg\.id \|\| index, 'error'\)"[^>]*role="alert"/)
      assert.equal((source.match(/:aria-describedby="msg\.lead\.error \? leadFieldId\(uid, msg\.id \|\| index, 'error'\)/g) ?? []).length, 2)
      assert.equal((source.match(/:aria-invalid="leadContactInvalid\(msg\.lead\)/g) ?? []).length, 2)
    })
  }
})

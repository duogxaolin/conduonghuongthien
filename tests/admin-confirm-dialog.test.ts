import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { normalizeConfirmOptions, useConfirm } from '../app/composables/useConfirm.ts'

/**
 * Hộp xác nhận dùng chung của trang quản trị (`useConfirm` + `ConfirmModal.vue`).
 *
 * Ba lỗi cũ được khoá ở đây:
 *   1. `tone`/`confirmText` khai trong kiểu nhưng modal chỉ đọc `danger`/`confirmLabel`
 *      — "Khởi động lại Website" hiện như câu hỏi thường, nhãn "Xác nhận" chung chung.
 *   2. Mở một hộp đè lên hộp đang chờ làm promise của hộp trước treo vĩnh viễn.
 *   3. Enter gắn trên `window` gọi `accept()` trước cú click của nút đang focus:
 *      đứng ở "Hủy" bấm Enter vẫn thành đồng ý.
 */

describe('normalizeConfirmOptions — alias cũ về đúng trường modal đọc', () => {
  it('chuỗi trần thành { message }, không nguy hiểm', () => {
    const opts = normalizeConfirmOptions('Xoá?')
    assert.equal(opts.message, 'Xoá?')
    assert.equal(opts.danger, false)
    assert.equal(opts.confirmLabel, undefined)
  })

  it('confirmText → confirmLabel, tone: danger → danger: true', () => {
    const opts = normalizeConfirmOptions({ message: 'm', confirmText: 'Khởi động lại Website', tone: 'danger' })
    assert.equal(opts.confirmLabel, 'Khởi động lại Website')
    assert.equal(opts.danger, true)
  })

  it('confirmLabel thắng alias; danger: true giữ nguyên; tone: primary không phải nguy hiểm', () => {
    assert.equal(normalizeConfirmOptions({ message: 'm', confirmLabel: 'A', confirmText: 'B' }).confirmLabel, 'A')
    assert.equal(normalizeConfirmOptions({ message: 'm', danger: true }).danger, true)
    assert.equal(normalizeConfirmOptions({ message: 'm', tone: 'primary' }).danger, false)
  })
})

describe('useConfirm — vòng đời promise', () => {
  it('accept → true, cancel → false, và hộp đóng lại', async () => {
    const { confirm, accept, cancel, confirmState } = useConfirm()
    const first = confirm({ message: 'a', tone: 'danger', confirmText: 'Xoá' })
    assert.equal(confirmState.visible, true)
    assert.equal(confirmState.options.danger, true)
    assert.equal(confirmState.options.confirmLabel, 'Xoá')
    accept()
    assert.equal(await first, true)
    assert.equal(confirmState.visible, false)

    const second = confirm('b')
    cancel()
    assert.equal(await second, false)
  })

  it('mở đè lên hộp đang chờ: hộp trước nhận false, không treo', async () => {
    const { confirm, accept, confirmState } = useConfirm()
    const first = confirm('một')
    const second = confirm('hai')
    assert.equal(await first, false)
    assert.equal(confirmState.options.message, 'hai')
    accept()
    assert.equal(await second, true)
  })

  it('prompt trả chữ đã gõ, chuỗi rỗng khi đồng ý không gõ gì, null khi Hủy', async () => {
    const { prompt, accept, cancel, confirmState } = useConfirm()

    const typed = prompt({ message: 'Chặn?', label: 'Lý do', defaultValue: '' })
    assert.equal(confirmState.input?.label, 'Lý do')
    confirmState.input!.value = 'spam'
    accept()
    assert.equal(await typed, 'spam')

    const empty = prompt({ message: 'Chặn?', label: 'Lý do' })
    accept()
    assert.equal(await empty, '')

    const cancelled = prompt({ message: 'Chặn?', label: 'Lý do', defaultValue: 'x' })
    cancel()
    assert.equal(await cancelled, null)
  })

  it('hộp xác nhận thường không có ô nhập; prompt bị mở đè trả null', async () => {
    const { confirm, prompt, cancel, confirmState } = useConfirm()
    const asked = prompt({ message: 'Lý do?' })
    const plain = confirm('Tiếp tục?')
    assert.equal(await asked, null)
    assert.equal(confirmState.input, null)
    cancel()
    assert.equal(await plain, false)
  })
})

describe('ConfirmModal — Enter không còn là "đồng ý" bất kể focus ở đâu', () => {
  const source = readFileSync(new URL('../app/components/admin/ConfirmModal.vue', import.meta.url), 'utf8')
  const script = source.slice(0, source.indexOf('</script>'))

  it('không bắt Enter ở cấp window để gọi accept()', () => {
    assert.doesNotMatch(script, /key === 'Enter'/)
  })

  it('nút nguy hiểm mở ra ở "Hủy", Tab quay vòng trong hộp, đóng thì trả focus', () => {
    assert.match(script, /options\.danger \? cancelBtn\.value : confirmBtn\.value/)
    assert.match(script, /trapTabTarget\(/)
    assert.match(script, /focusReturn\.restore\(/)
    assert.match(source, /@keydown\.tab="onTrapTab"/)
  })
})

describe('useConfirm — hộp nối hộp', () => {
  it('mỗi lần mở tăng seq, kể cả khi hộp sau mở ngay trong cùng nhịp hộp trước đóng', async () => {
    const { confirm, prompt, accept, confirmState } = useConfirm()
    const before = confirmState.seq
    const reason = prompt({ message: 'Lý do?' })
    accept()
    assert.equal(await reason, '')
    const next = confirm({ message: 'Chặn?', danger: true })
    assert.equal(confirmState.seq, before + 2, 'modal theo dõi seq nên vẫn nhận ra hộp thứ hai')
    assert.equal(confirmState.input, null, 'hộp thứ hai là xác nhận thường, không còn ô nhập')
    accept()
    assert.equal(await next, true)
  })
})

/**
 * Lối thoát của lớp phủ "Đang tải..." (`app/utils/boot-overlay.ts`).
 *
 * Script failsafe là một CHUỖI chạy ngoài trình biên dịch, trước mọi bundle —
 * lỗi cú pháp hay sai id ở đó không có typecheck nào bắt. Vì thế test này CHẠY
 * chính chuỗi đó trên một DOM giả và đồng hồ giả, rồi so với `hideBootOverlay`
 * (đường plugin lỗi dùng) để hai đường luôn làm cùng một việc.
 *
 * Hành vi trong trình duyệt thật (tắt JS, chặn bundle, tải bình thường) nằm ở
 * `tests/e2e/public-language-cache.spec.ts`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOT_OVERLAY_FAILSAFE_MS,
  BOOT_OVERLAY_ID,
  BOOT_OVERLAY_NOSCRIPT_CSS,
  bootOverlayFailsafeScript,
  hideBootOverlay,
} from '../app/utils/boot-overlay'

function fakeOverlay() {
  const attrs: Record<string, string> = { 'aria-busy': 'true' }
  const el = {
    style: { display: '' },
    setAttribute(name: string, value: string) { attrs[name] = value },
    attrs,
  }
  const doc = { getElementById: (id: string) => (id === BOOT_OVERLAY_ID ? el : null) }
  return { el, doc }
}

function runFailsafe(doc: unknown) {
  const timers: Array<{ fn: () => void, ms: number }> = []
  const fakeSetTimeout = (fn: () => void, ms: number) => { timers.push({ fn, ms }) }
  // Chạy đúng chuỗi sẽ được nhúng vào <head>, với document/setTimeout giả.
  new Function('document', 'setTimeout', bootOverlayFailsafeScript())(doc, fakeSetTimeout)
  return timers
}

test('script failsafe hẹn đúng MỘT lần ẩn sau BOOT_OVERLAY_FAILSAFE_MS, không đụng DOM trước hạn', () => {
  const { el, doc } = fakeOverlay()
  const timers = runFailsafe(doc)
  assert.equal(timers.length, 1)
  assert.equal(timers[0]!.ms, BOOT_OVERLAY_FAILSAFE_MS)
  assert.ok(BOOT_OVERLAY_FAILSAFE_MS > 0 && BOOT_OVERLAY_FAILSAFE_MS <= 5000, 'trần ~4 s theo yêu cầu')
  assert.equal(el.style.display, '', 'trước hạn lớp phủ vẫn hiện')

  timers[0]!.fn()
  assert.equal(el.style.display, 'none')
  assert.equal(el.attrs['aria-busy'], 'false')
})

test('script failsafe không ném khi lớp phủ đã được Vue gỡ (hydrate xong trước hạn)', () => {
  const timers = runFailsafe({ getElementById: () => null })
  assert.doesNotThrow(() => timers[0]!.fn())
})

test('hideBootOverlay (đường lỗi app:error/vue:error) làm đúng việc của script failsafe', () => {
  const { el, doc } = fakeOverlay()
  assert.equal(hideBootOverlay(doc), true)
  assert.equal(el.style.display, 'none')
  assert.equal(el.attrs['aria-busy'], 'false')
  assert.equal(hideBootOverlay({ getElementById: () => null }), false)
})

test('CSS trong <noscript> nhắm đúng id lớp phủ và thắng mọi lớp tiện ích', () => {
  assert.equal(BOOT_OVERLAY_NOSCRIPT_CSS, `#${BOOT_OVERLAY_ID}{display:none!important}`)
  assert.doesNotMatch(BOOT_OVERLAY_NOSCRIPT_CSS, /<\/?(style|noscript)/i, 'chuỗi CSS không tự đóng thẻ bao ngoài')
})

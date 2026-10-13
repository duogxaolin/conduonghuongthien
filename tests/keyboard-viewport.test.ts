import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useKeyboardViewport } from '../app/composables/useKeyboardViewport'

/**
 * Khung chat toàn màn hình trên điện thoại cao `100dvh`, mà `dvh` không co lại khi
 * bàn phím mở — iOS Safari chỉ thu nhỏ *visual viewport*. `useKeyboardViewport`
 * đặt `top`/`height` theo `visualViewport` để ô nhập không nằm dưới bàn phím.
 *
 * Trình duyệt headless không có bàn phím ảo, nên ở đây `visualViewport` được giả
 * và bàn phím "mở" bằng cách thu nhỏ nó rồi phát sự kiện `resize`/`scroll` — đúng
 * cách iOS báo. Test này kiểm logic; bàn phím thật trên máy thật vẫn cần thử tay.
 */

type Listener = () => void

function fakeViewport(initial: { height: number, offsetTop?: number }) {
  const listeners = new Map<string, Set<Listener>>()
  const viewport = {
    height: initial.height,
    offsetTop: initial.offsetTop ?? 0,
    addEventListener: (type: string, fn: Listener) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn) },
    removeEventListener: (type: string, fn: Listener) => { listeners.get(type)?.delete(fn) },
    emit: (type: string) => listeners.get(type)?.forEach(fn => fn()),
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  }
  return viewport
}

async function withWindow<T>(options: { desktop?: boolean, viewport: ReturnType<typeof fakeViewport> | null }, run: () => Promise<T> | T): Promise<T> {
  const original = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = {
    visualViewport: options.viewport,
    matchMedia: () => ({ matches: Boolean(options.desktop) }),
  }
  try { return await run() } finally { (globalThis as { window?: unknown }).window = original }
}

test('opening on a phone sizes the dialog to the visible area', async () => {
  const viewport = fakeViewport({ height: 800 })
  await withWindow({ viewport }, async () => {
    const scope = effectScope()
    const open = ref(false)
    const { keyboardViewportStyle } = scope.run(() => useKeyboardViewport(open))!
    assert.deepEqual(keyboardViewportStyle.value, {}, 'closed: the h-[100dvh] class is in charge')
    open.value = true
    await nextTick()
    assert.deepEqual(keyboardViewportStyle.value, { top: '0px', height: '800px' })
    scope.stop()
  })
})

test('the keyboard opening shrinks the dialog and keeps it inside the visible area', async () => {
  const viewport = fakeViewport({ height: 800 })
  await withWindow({ viewport }, async () => {
    const scope = effectScope()
    const open = ref(true)
    const { keyboardViewportStyle } = scope.run(() => useKeyboardViewport(open))!
    await nextTick()
    // The keyboard covers 330px and iOS pans the page 40px to keep the input in view.
    viewport.height = 470
    viewport.offsetTop = 40
    viewport.emit('resize')
    assert.deepEqual(keyboardViewportStyle.value, { top: '40px', height: '470px' })
    // Panning without a resize (the visitor drags the page) is followed too.
    viewport.offsetTop = 0
    viewport.emit('scroll')
    assert.deepEqual(keyboardViewportStyle.value, { top: '0px', height: '470px' })
    // The keyboard closes: back to the full height.
    viewport.height = 800
    viewport.emit('resize')
    assert.deepEqual(keyboardViewportStyle.value, { top: '0px', height: '800px' })
    scope.stop()
  })
})

test('closing the dialog stops listening and hands sizing back to the CSS class', async () => {
  const viewport = fakeViewport({ height: 700 })
  await withWindow({ viewport }, async () => {
    const scope = effectScope()
    const open = ref(true)
    const { keyboardViewportStyle } = scope.run(() => useKeyboardViewport(open))!
    await nextTick()
    assert.equal(viewport.listenerCount(), 2, 'resize + scroll')
    open.value = false
    await nextTick()
    assert.equal(viewport.listenerCount(), 0)
    assert.deepEqual(keyboardViewportStyle.value, {})
    // Reopening must not stack a second pair of listeners.
    open.value = true
    await nextTick()
    assert.equal(viewport.listenerCount(), 2)
    scope.stop()
  })
})

test('disposing the scope removes the listeners even while the dialog is open', async () => {
  const viewport = fakeViewport({ height: 700 })
  await withWindow({ viewport }, async () => {
    const scope = effectScope()
    const open = ref(true)
    scope.run(() => useKeyboardViewport(open))
    await nextTick()
    assert.equal(viewport.listenerCount(), 2)
    scope.stop()
    assert.equal(viewport.listenerCount(), 0)
  })
})

test('on tablet and desktop the floating panel is never resized', async () => {
  const viewport = fakeViewport({ height: 900 })
  await withWindow({ viewport, desktop: true }, async () => {
    const scope = effectScope()
    const open = ref(true)
    const { keyboardViewportStyle } = scope.run(() => useKeyboardViewport(open))!
    await nextTick()
    viewport.height = 500
    viewport.emit('resize')
    assert.deepEqual(keyboardViewportStyle.value, {})
    scope.stop()
  })
})

test('a browser without visualViewport is left on the CSS height', async () => {
  await withWindow({ viewport: null }, async () => {
    const scope = effectScope()
    const open = ref(false)
    const { keyboardViewportStyle } = scope.run(() => useKeyboardViewport(open))!
    open.value = true
    await nextTick()
    assert.deepEqual(keyboardViewportStyle.value, {})
    scope.stop()
  })
})

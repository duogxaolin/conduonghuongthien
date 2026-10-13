import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * `setInterval` phía server không bao giờ được dọn: `onUnmounted` không chạy khi
 * SSR, nên mỗi lượt render để lại một bộ đếm giờ sống mãi trong tiến trình Node
 * (và giữ nguyên component nó bắt). `RoleModelsBlock` làm đúng điều đó trên mọi
 * lượt render trang chủ, vì `watch(..., { immediate: true })` chạy cả ở server —
 * Nuxt 4.6 chỉ vừa mới lên tiếng (`NUXT_E1004`).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('the role-models carousel never starts its autoplay timer on the server', () => {
  const source = read('../app/components/blocks/RoleModelsBlock.vue')
  const start = source.slice(source.indexOf('const startAutoplay = () => {'))
  const body = start.slice(0, start.indexOf('\n}\n'))
  assert.match(body, /if \(!import\.meta\.client\) return/, 'startAutoplay must bail out before touching setInterval on the server')
  assert.ok(
    body.indexOf('import.meta.client') < body.indexOf('setInterval('),
    'the client guard must come before the timer is created',
  )
})

test('every timer started from an immediate watcher is guarded for the client', () => {
  // The shape that caused it: a watcher with `immediate: true` whose callback ends
  // in a function that calls setInterval. Any component with both needs the guard.
  const offenders = ['../app/components/blocks/RoleModelsBlock.vue', '../app/components/LiveHero.vue', '../app/components/LiveTickerBar.vue', '../app/components/ChatWidget.vue']
    .filter((path) => {
      const source = read(path)
      return /immediate:\s*true/.test(source) && /\bsetInterval\(/.test(source) && !/import\.meta\.client|onMounted/.test(source)
    })
  assert.deepEqual(offenders, [])
})

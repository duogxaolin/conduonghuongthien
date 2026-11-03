import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * `/media/<id>`: khối "video cùng chuyên mục" phải vẽ CÙNG MỘT thứ ở máy chủ và ở lượt hydrate đầu.
 * `watch(item, …, { immediate: true })` chạy `loadRelated()` ngay lúc setup trên client, đặt
 * `relatedPending = true` trước lượt dựng đầu; mặc định `false` làm máy chủ vẽ câu "Chưa có video
 * khác" còn client vẽ khung chờ → "Hydration node mismatch" (đo 2026-11-03). Kiểm văn bản nguồn —
 * chứng minh cấu trúc, không chứng minh hành vi; hành vi đã đo bằng Chromium trên bản docker.
 */
const source = readFileSync(new URL('../app/pages/media/[shortId].vue', import.meta.url), 'utf8')

test('relatedPending khởi tạo true (máy chủ vẽ khung chờ như client)', () => {
  assert.match(source, /const relatedPending = ref\(true\)/)
  assert.doesNotMatch(source, /const relatedPending = ref\(false\)/)
})

test('không có video hiện tại thì cờ chờ được hạ xuống (không kẹt khung chờ)', () => {
  const body = source.slice(source.indexOf('async function loadRelated()'))
  const guard = body.slice(0, body.indexOf('relatedPending.value = true'))
  assert.match(guard, /if \(!current\) \{[\s\S]*relatedPending\.value = false[\s\S]*return/)
})

test('khung chờ nằm TRƯỚC câu "chưa có video khác" trong template', () => {
  const pending = source.indexOf('v-if="relatedPending"')
  const empty = source.indexOf('v-else-if="!related.length"')
  assert.ok(pending > 0 && empty > pending)
})

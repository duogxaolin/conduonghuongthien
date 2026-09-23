/**
 * Kiểm `selectMediaCacheKeys` — hàm thuần lọc khoá cache, chỉ giữ trang **danh
 * sách** `/media`, loại bỏ trang chi tiết `/media/<shortId>`.
 *
 * Hàm thuần (mảng → mảng, không I/O) nên ghim được không cần Nitro runtime.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { selectMediaCacheKeys } from '../server/utils/media-cache-purge.ts'

test('selectMediaCacheKeys', async (t) => {
  await t.test('chỉ giữ khoá `/media` (danh sách), bỏ `/media/<shortId>` (chi tiết)', () => {
    const keys = [
      'nitro/routes:/media:GET.json',
      'nitro/routes:/media/dQw4w9WgXcQ:GET.json',
      'nitro/routes:/media/ytsave-...-1080p:GET.json',
      // Các trang công khai khác không liên quan
      'nitro/routes:/:GET.json',
      'nitro/routes:/news:GET.json',
      'nitro/routes:/news/bai-moi:GET.json',
      'nitro/routes:/qa-documents:GET.json',
    ]
    const result = selectMediaCacheKeys(keys)
    assert.deepEqual(result, ['nitro/routes:/media:GET.json'])
  })

  await t.test('không bắt nhầm đường dẫn có tiền tố `/media` nhưng không phải danh sách', () => {
    const keys = [
      'nitro/routes:/media:GET.json',           // danh sách — giữ
      'nitro/routes:/media-abc:GET.json',        // không phải /media — bỏ
      'nitro/routes:/medias:GET.json',           // không phải /media — bỏ
      'nitro/routes:/media/-x:GET.json',         // chi tiết — bỏ
    ]
    const result = selectMediaCacheKeys(keys)
    assert.deepEqual(result, ['nitro/routes:/media:GET.json'])
  })

  await t.test('hỗ trợ cả HEAD và method khác', () => {
    const keys = [
      'nitro/routes:/media:GET.json',
      'nitro/routes:/media:HEAD.json',
      'nitro/routes:/media/dQw4w9WgXcQ:GET.json',
    ]
    const result = selectMediaCacheKeys(keys)
    assert.deepEqual(result, [
      'nitro/routes:/media:GET.json',
      'nitro/routes:/media:HEAD.json',
    ])
  })

  await t.test('mảng rỗng trả rỗng', () => {
    assert.deepEqual(selectMediaCacheKeys([]), [])
  })

  await t.test('khoá có query string (vd. /media?category=xx) không bị nhầm', () => {
    // Nitro encode query vào path: /media?category=... vẫn có routePath bắt
    // đầu bằng `/media` nhưng KHÔNG kết thúc bằng đúng `/media` — nên không bắt.
    // Chỉ `/media` thuần (không query) mới được giữ. Điều này đúng: SWR cache
    // theo route path, không theo query — một entry `/media:GET.json` phục vụ
    // mọi query. Query variant (nếu có) sẽ tự hết hạn.
    const keys = [
      'nitro/routes:/media:GET.json',
      // Không có dạng `/media?category=...` trong Nitro — query nằm ngoài key.
    ]
    const result = selectMediaCacheKeys(keys)
    assert.deepEqual(result, ['nitro/routes:/media:GET.json'])
  })

  await t.test('khoá không có tiền tố nitro/routes: vẫn xử lý được', () => {
    // `useStorage('cache').getKeys('nitro/routes')` trả khoá không có tiền tố
    // `cache:` (unstorage tự thêm khi duyệt). Nhưng để an toàn, hàm vẫn hoạt
    // động nếu khoá có hoặc không có tiền tố `nitro/routes:`.
    const keys = [
      'nitro/routes:/media:GET.json',
      '/media:GET.json',
      'nitro/routes:/media/dQw4w9WgXcQ:GET.json',
    ]
    const result = selectMediaCacheKeys(keys)
    // Cả hai dạng `/media` đều được giữ, chi tiết bị bỏ.
    assert.deepEqual(result, [
      'nitro/routes:/media:GET.json',
      '/media:GET.json',
    ])
  })
})

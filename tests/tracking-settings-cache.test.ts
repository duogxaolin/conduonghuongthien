import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Cấu hình mã theo dõi đệm 30 s (`server/utils/tracking-settings.ts`) phải xoá được ngay khi lưu cài đặt.
 *
 * Lỗi gốc (verifier 2026-11-06): settings PUT xoá đệm `swr` của trang công khai nhưng không xoá bộ đệm này —
 * lượt dựng kế tiếp chèn lại đoạn mã CŨ và `swr` giữ nó thêm 60 s, nên gỡ một script tự viết còn chạy ~90 s.
 */
let rows: Array<{ key: string, value: string }> = []
let reads = 0
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({ select: () => ({ from: async () => { reads += 1; return rows } }) }),
    getPool: () => null,
  },
})

const { loadTrackingSettings, clearTrackingSettingsCache, TRACKING_KEYS } = await import('../server/utils/tracking-settings')

test('the copy is reused for 30 s, and a clear makes the next render read the new value', async () => {
  clearTrackingSettingsCache()
  rows = [{ key: 'tracking_custom_head', value: '<script>old()</script>' }]
  reads = 0
  assert.equal((await loadTrackingSettings())?.tracking_custom_head, '<script>old()</script>')
  rows = [{ key: 'tracking_custom_head', value: '' }]
  assert.equal((await loadTrackingSettings())?.tracking_custom_head, '<script>old()</script>', 'inside the window the copy is reused')
  assert.equal(reads, 1)

  clearTrackingSettingsCache()
  assert.equal((await loadTrackingSettings())?.tracking_custom_head, '', 'the removed script must not be injected again')
  assert.equal(reads, 2)
})

test('every key the injector reads is one the settings save clears on', () => {
  for (const key of ['tracking_custom_head', 'tracking_custom_body', 'ga4_measurement_id', 'gtm_container_id', 'tracking_enabled']) {
    assert.ok((TRACKING_KEYS as readonly string[]).includes(key), key)
  }
})

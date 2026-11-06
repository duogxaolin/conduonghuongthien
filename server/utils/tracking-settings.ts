/**
 * Cấu hình mã theo dõi (GA4, GTM, pixel…, `tracking_custom_head/body`) đọc từ bảng `settings`, đệm 30 s để mỗi
 * lượt dựng trang không phải truy vấn — tách từ `server/plugins/tracking.ts` để handler lưu cài đặt xoá được nó.
 *
 * Vì sao phải xoá được (verifier 2026-11-06): lưu cài đặt xoá đệm `swr` của trang công khai, nhưng lượt dựng kế
 * tiếp lại chèn đoạn mã CŨ từ bộ đệm 30 s này, rồi `swr` giữ nó thêm 60 s — gỡ một đoạn script tự viết của
 * SuperAdmin còn chạy trên trang tới ~90 s. Cùng kiểu "bộ đệm ngắn nạp lại bộ đệm dài" với CHANGELOG § 78;
 * favicon và ảnh OG đã có hàm xoá riêng.
 */
import { getDb } from './db'
import { settings } from '../db/schema'

export const TRACKING_KEYS = [
  'tracking_enabled',
  'ga4_measurement_id',
  'gtm_container_id',
  'google_ads_id',
  'google_ads_conversion_label',
  'google_site_verification',
  'facebook_pixel_id',
  'tiktok_pixel_id',
  'clarity_project_id',
  'tracking_custom_head',
  'tracking_custom_body',
] as const

export type TrackingSettings = Record<(typeof TRACKING_KEYS)[number], string>

// ─── In-module cache (short TTL so every render doesn't hit the DB) ──────────
const CACHE_TTL_MS = 30_000
let cache: { data: TrackingSettings; expires: number } | null = null

export async function loadTrackingSettings(): Promise<TrackingSettings | null> {
  const now = Date.now()
  if (cache && cache.expires > now) return cache.data

  try {
    const db = getDb()
    const rows = await db.select().from(settings)
    const map: Record<string, string> = {}
    for (const r of rows) {
      if (r.key) map[r.key] = r.value == null ? '' : String(r.value)
    }
    const data = {} as TrackingSettings
    for (const k of TRACKING_KEYS) data[k] = map[k] ?? ''
    cache = { data, expires: now + CACHE_TTL_MS }
    return data
  } catch {
    // Any DB error → inject nothing, never throw.
    return null
  }
}

/** Gọi SAU khi lưu một khoá trong `TRACKING_KEYS` (settings PUT), TRƯỚC khi xoá đệm trang công khai. */
export function clearTrackingSettingsCache(): void {
  cache = null
}

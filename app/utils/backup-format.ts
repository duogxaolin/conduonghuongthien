/**
 * Định dạng thời điểm backup theo giờ Việt Nam; chuỗi không hợp lệ trả nguyên văn.
 * `backups.created_at` là cột NULL được: NULL hiện '—', không phải `new Date(null)` =
 * "1/1/1970" (tests/admin-fetch-rollout-settings.test.ts).
 */
export const formatWhen = (v: string | null) => {
  if (v === null) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('vi-VN')
}

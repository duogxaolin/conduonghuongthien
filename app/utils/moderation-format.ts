/**
 * Display helpers of the `/admin/ai/moderation` panels — pure, shared by the review
 * queue and the worker panel (moved verbatim out of the page when it was split).
 */

/** Short Vietnamese date and time; '—' when there is none. */
export function formatModerationTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

/** The worker's uptime, read aloud: "45 giây", "3 phút 20 giây", "2 giờ 5 phút". */
export function formatUptime(seconds: number): string {
  if (!seconds || seconds < 60) return `${seconds || 0} giây`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} phút ${seconds % 60} giây`
  const hours = Math.floor(mins / 60)
  return `${hours} giờ ${mins % 60} phút`
}

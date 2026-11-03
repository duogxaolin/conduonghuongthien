/**
 * Chuỗi "bị từ chối vì bận" của scheduler sao lưu (`backup-scheduler.ts`) và thư cảnh báo
 * `backup.scheduler_blocked` — tách khỏi tệp scheduler (quy tắc ~400 dòng). Trạng thái
 * cấp module chỉ ở đây; hạn chót của một chuỗi do `busyStreakDeadline` (scheduler, hàm
 * thuần) tính và truyền vào. Không import scheduler — không vòng import.
 *
 * Một chuỗi thuộc MỘT khe; mở ở lần bị từ chối đầu tiên cho khe đó; tick tới hạn bị từ chối
 * cho một khe KHÁC mở chuỗi mới — mỗi khe mất một thư, nêu đúng khe (thư theo ngày không
 * bị cửa sổ 15 phút của `ops-alert` gộp, và đó là chủ đích: mỗi khe mất là một bản sao lưu
 * không có). Xoá khi một lượt BẮT ĐẦU (giữ được khoá — mọi lượt thành công đều qua đây;
 * lượt bắt đầu rồi hỏng không còn là "bận", `attempts`/`backup.slot_abandoned` lo) và khi
 * công tắc tự động tắt. Trong bộ nhớ: khởi động lại tiến trình thì mở lại từ lần bị từ chối
 * kế tiếp.
 */
import { logWarn } from '../utils/logger'

let busyStreak: { slot: string; since: string; deadline: number; busyTicks: number; reason: string; alerted: boolean } | null = null

/** Một tick tới hạn bị từ chối vì bận: nối vào chuỗi của khe đó, hoặc mở chuỗi mới (khe khác). Trả số lần bị từ chối của chuỗi. */
export function noteBusyRefusal(slot: string, deadline: number, now: Date, reason: string): number {
  if (!busyStreak || busyStreak.slot !== slot) {
    busyStreak = { slot, since: now.toISOString(), deadline, busyTicks: 0, reason, alerted: false }
  }
  busyStreak.busyTicks += 1
  busyStreak.reason = reason
  return busyStreak.busyTicks
}

/** Một lượt đã bắt đầu, hoặc công tắc tự động tắt: không còn chuỗi nào. */
export function clearBusyStreak(): void {
  busyStreak = null
}

/**
 * Gọi ở CUỐI mỗi tick, kể cả tick không tới hạn (sau cửa sổ của khe không còn tick tới hạn
 * nào để kiểm): chuỗi còn mở và đã quá hạn → một dòng warn, một lần mỗi chuỗi. Tick vừa bắt
 * đầu được một lượt đã xoá chuỗi, nên không bao giờ báo ngay trước lượt đó. Không ném.
 */
export function alertIfBusyPastDeadline(now: Date): void {
  if (!busyStreak || busyStreak.alerted || now.getTime() < busyStreak.deadline) return
  busyStreak.alerted = true
  logWarn({
    event: 'backup.scheduler_blocked',
    slot: busyStreak.slot,
    since: busyStreak.since,
    busyTicks: busyStreak.busyTicks,
    reason: busyStreak.reason,
  })
}

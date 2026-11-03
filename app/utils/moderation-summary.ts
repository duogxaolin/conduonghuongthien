/**
 * Số liệu tóm tắt của tab "Kiểm duyệt An ninh" trong AI Panel (design D10, spec
 * `admin-moderation-ui`). Quản lý quy tắc và xử lý hàng đối soát chỉ ở MỘT nơi —
 * `/admin/ai/moderation`; tab chỉ hiện hai con số + liên kết sang đó.
 *
 * Hàm thuần đọc phản hồi của hai endpoint sẵn có:
 *   - `GET /api/admin/ai/moderation/queue?status=pending&perPage=1` → `total` là số
 *     hàng chờ THẬT (đếm trước LIMIT). Bản chép cũ đếm `items.filter(...)` trên trang
 *     20 dòng nên huy hiệu không bao giờ vượt 20.
 *   - `GET /api/admin/ai/moderation/rules` → mọi quy tắc; đếm quy tắc đang bật.
 *
 * Phản hồi sai dạng là LỖI (ném) — để tab hiện nhánh lỗi + "Thử lại", không phải
 * "0 hàng chờ" khiến cán bộ tưởng không còn gì phải xử lý.
 */
import type { ModerationResolveResponse } from '~/types/moderation'

/**
 * Huy hiệu "chờ đối soát" của trang `/admin/ai/moderation`. Không bao giờ đếm trên một
 * trang hàng đợi (20 dòng) — cùng lỗi trần 20 của tab cũ:
 *   - tổng ĐÃ TẢI là của bộ lọc `pending` (`queueTotalFilter`, đặt khi phản hồi về —
 *     không phải lúc bấm đổi bộ lọc): dùng nó, mới nhất sau mỗi lần tải;
 *   - còn lại: tổng `pending` của `worker-status` (`pendingQueueCount`);
 *   - không có cả hai (worker-status hỏng/chưa tải): `null` — ẩn huy hiệu, KHÔNG hiện
 *     "0" như thể không còn gì phải xử lý.
 */
export function pendingBadgeCount(input: { queueTotal: number; queueTotalFilter: string | null; workerPending: number | null }): number | null {
  if (input.queueTotalFilter === 'pending') return input.queueTotal
  return input.workerPending
}

/**
 * Câu báo sau khi xử lý một hàng đối soát, theo `restore` mà máy chủ trả
 * (`server/services/moderated-content.ts`). "Bỏ ẩn" không phải lúc nào cũng hiện lại nội
 * dung — cán bộ ẩn tay, lần ẩn khác, tác giả bị chặn, nội dung đã xoá đều giữ nguyên — và
 * báo "thành công" chung chung cho các trường hợp đó là để cán bộ tưởng nội dung đã công khai.
 * Xoá / Cấm IP (`restore` null) giữ câu cũ.
 */
export function resolveOutcomeNotice(restore: ModerationResolveResponse['restore'] | undefined): { type: 'success' | 'warning', message: string } {
  switch (restore) {
    case 'restored': return { type: 'success', message: 'Đã duyệt an toàn: nội dung đã hiển thị công khai lại.' }
    case 'visible': return { type: 'success', message: 'Đã duyệt an toàn: nội dung vẫn đang hiển thị.' }
    case 'not_applicable': return { type: 'success', message: 'Đã duyệt an toàn. Mục này không có nội dung bị ẩn để hiển thị lại.' }
    case 'not_restored': return { type: 'warning', message: 'Đã duyệt, nhưng nội dung VẪN BỊ ẨN: nó đang bị ẩn vì lý do khác (cán bộ ẩn tay, một lần ẩn khác) hoặc tác giả đang bị chặn.' }
    case 'gone': return { type: 'warning', message: 'Đã duyệt, nhưng nội dung không còn tồn tại (đã bị xoá).' }
    default: return { type: 'success', message: 'Đã xử lý đối soát thành công!' }
  }
}

export interface ModerationSummary {
  pendingCount: number
  activeRuleCount: number
  totalRuleCount: number
}

export function summarizeModeration(
  queue: { total?: unknown },
  rules: { rules?: ReadonlyArray<{ isEnabled?: unknown }> },
): ModerationSummary {
  const total = queue.total
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new Error('Phản hồi hàng đối soát thiếu tổng số hợp lệ.')
  }
  if (!Array.isArray(rules.rules)) {
    throw new Error('Phản hồi quy tắc kiểm duyệt thiếu danh sách quy tắc.')
  }
  return {
    pendingCount: total,
    activeRuleCount: rules.rules.filter(rule => rule.isEnabled === true).length,
    totalRuleCount: rules.rules.length,
  }
}

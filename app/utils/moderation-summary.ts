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
/**
 * Huy hiệu "chờ đối soát" của trang `/admin/ai/moderation`. Không bao giờ đếm trên một
 * trang hàng đợi (20 dòng) — cùng lỗi trần 20 của tab cũ:
 *   - đang lọc `pending`: tổng của chính truy vấn đó (`total`, mới nhất sau mỗi lần tải);
 *   - lọc trạng thái khác: tổng `pending` của `worker-status` (`pendingQueueCount`).
 */
export function pendingBadgeCount(input: { filter: string; queueTotal: number; workerPending: number | null }): number {
  if (input.filter === 'pending') return input.queueTotal
  return input.workerPending ?? 0
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

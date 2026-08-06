import { computed, ref, watch, type Ref } from 'vue'

// Đường dẫn tương đối, KHÔNG alias `~/`: bộ nạp test (`scripts/ts-resolver.mjs`)
// không biết alias của Nuxt, nên một import `~/…` ở đây là một composable chỉ
// kiểm được bằng cách mount cả trang — đúng điều việc tách này ra để tránh.
import { isWarningOrError } from '../utils/analytics-noc'

/**
 * Trạng thái tương tác của bảng NOC trong màn hình analytics trực tuyến.
 *
 * Rút khỏi `AnalyticsLiveDashboard.client.vue` vì đây là **một khối tự đủ**: nó
 * chỉ cần dữ liệu NOC vào và trả ra các giá trị đã dẫn xuất, không chạm tới
 * đồng hồ, bộ đếm poll hay hai panel còn lại. Phần *template* của bảng NOC thì
 * **cố ý ở nguyên chỗ cũ** — nó dùng 22 định danh của component cha, nên đẩy
 * chúng qua props/emit là tăng bề mặt phức tạp để giảm số dòng.
 *
 * Ranh giới đó không tuỳ ý: cái tách ra được là cái kiểm được không cần mount.
 *
 * **`nocSummary` từng viết lại chính biểu thức của `isWarningOrError`** dưới
 * dạng một regex thứ hai ngay trong component. Hai định nghĩa cho cùng một khái
 * niệm là chỗ để chúng lệch nhau: bảng có thể lọc theo một danh sách mức độ
 * trong khi ô tổng đếm theo một danh sách khác, và cả hai con số đều trông hợp
 * lý. Ở đây chỉ có một định nghĩa, và nó là định nghĩa đã có test riêng.
 */
export interface NocRow {
  id: number
  bucketStart: string
  eventType: string
  severity: string
  component: string
  status: string
  errorCode: string
  eventCount: number
  duration: { count: number, averageMs: number, maxMs: number }
  details: Record<string, number | boolean | string> | null
}

export const NOC_PAGE_SIZE = 10

export function useAnalyticsNocTable(rows: Ref<NocRow[] | undefined>) {
  const page = ref(1)
  /** `true` = chỉ hiện hàng cảnh báo/lỗi. */
  const severityOnly = ref(false)
  const dismissedIds = ref(new Set<number>())
  const expandedId = ref<number | null>(null)

  /**
   * Mới nhất trước. Sắp xếp ở đây, không ở máy chủ, vì bảng cho phép bỏ qua
   * từng hàng — thứ tự phải giữ nguyên khi một hàng biến mất khỏi danh sách.
   */
  const newest = computed(() =>
    [...(rows.value || [])].sort((a, b) => Date.parse(b.bucketStart) - Date.parse(a.bucketStart)))

  const filtered = computed(() => {
    let list = newest.value.filter(row => !dismissedIds.value.has(row.id))
    if (severityOnly.value) list = list.filter(row => isWarningOrError(row.severity))
    return list
  })

  const pageRows = computed(() => {
    const start = (page.value - 1) * NOC_PAGE_SIZE
    return filtered.value.slice(start, start + NOC_PAGE_SIZE)
  })

  const totalPages = computed(() =>
    Math.max(1, Math.ceil((filtered.value.length || 0) / NOC_PAGE_SIZE)))

  /**
   * Ô tổng đọc `newest`, KHÔNG đọc `filtered`: nó trả lời "hệ thống đang thế
   * nào", còn bộ lọc và danh sách bỏ qua là lựa chọn hiển thị của người đang
   * xem. Đếm theo `filtered` sẽ khiến bỏ qua một hàng lỗi làm con số lỗi tụt
   * xuống — tức là ẩn một hàng khỏi mắt mình rồi kết luận sự cố đã hết.
   */
  const summary = computed(() => {
    const list = newest.value
    return {
      totalEvents: list.reduce((sum, row) => sum + row.eventCount, 0),
      warningErrorEvents: list
        .filter(row => isWarningOrError(row.severity))
        .reduce((sum, row) => sum + row.eventCount, 0),
      maxDuration: Math.max(0, ...list.map(row => row.duration.maxMs)),
      latestStatus: list.length ? list[0]!.status : 'Không có sự kiện',
    }
  })

  function toggleSeverityFilter() {
    severityOnly.value = !severityOnly.value
    // Về trang 1: sau khi lọc, trang đang xem có thể không còn hàng nào — một
    // bảng trống ở trang 3 đọc ra là "không có cảnh báo nào".
    page.value = 1
  }

  function dismissRow(id: number) {
    dismissedIds.value = new Set([...dismissedIds.value, id])
    if (expandedId.value === id) expandedId.value = null
  }

  function undismissAll() {
    dismissedIds.value = new Set()
  }

  function toggleRow(id: number) {
    expandedId.value = expandedId.value === id ? null : id
  }

  // Dữ liệu mới về thì quay lại trang 1 — giữ nguyên trang cũ trên một tập hàng
  // đã đổi là hiện một trang không tương ứng với gì.
  watch(rows, () => { page.value = 1 })

  return {
    page,
    severityOnly,
    dismissedIds,
    expandedId,
    newest,
    filtered,
    pageRows,
    totalPages,
    summary,
    toggleSeverityFilter,
    dismissRow,
    undismissAll,
    toggleRow,
  }
}

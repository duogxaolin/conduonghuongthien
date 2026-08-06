/**
 * Bảng NOC: bộ lọc và danh sách bỏ qua là lựa chọn hiển thị, KHÔNG được đổi ô tổng.
 *
 * Trước đây khối này nằm trong `<script setup>` của một SFC gần 1000 dòng, nên
 * cách duy nhất để kiểm là mount cả bảng điều khiển analytics — tức là trên
 * thực tế nó chưa từng được kiểm. Cùng lý do `safeDetails` đã được rút ra.
 *
 * Điều đáng ghim nhất ở đây không phải phép chia trang mà là **`summary` đọc
 * `newest` chứ không đọc `filtered`**: ô tổng trả lời "hệ thống đang thế nào",
 * còn bộ lọc trả lời "người xem đang muốn thấy gì". Nếu ô tổng đếm theo danh
 * sách đã lọc thì bỏ qua một hàng lỗi sẽ làm con số lỗi tụt xuống — người vận
 * hành ẩn một dòng khỏi mắt mình rồi kết luận sự cố đã hết. Đó là một kiểu hỏng
 * **không có triệu chứng nào**: cả hai con số đều trông hợp lý.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { computed, nextTick, ref } from 'vue'

import { NOC_PAGE_SIZE, useAnalyticsNocTable, type NocRow } from '../app/composables/useAnalyticsNocTable.ts'

function row(id: number, severity: string, eventCount = 1, maxMs = 10, minutesAgo = id): NocRow {
  return {
    id,
    // Mốc thời gian cố định, không `Date.now()`: một test đọc đồng hồ thật là
    // một test có thể đỏ vào đúng nửa đêm.
    bucketStart: new Date(Date.UTC(2026, 0, 1, 0, 60 - minutesAgo)).toISOString(),
    eventType: 'ingest',
    severity,
    component: 'analytics',
    status: severity === 'error' ? 'Lỗi ghi' : 'Bình thường',
    errorCode: '',
    eventCount,
    duration: { count: 1, averageMs: maxMs, maxMs },
    details: null,
  }
}

describe('useAnalyticsNocTable', () => {
  it('sắp xếp mới nhất trước, bất kể thứ tự máy chủ trả về', () => {
    const rows = ref<NocRow[]>([row(1, 'info'), row(5, 'info'), row(3, 'info')])
    const table = useAnalyticsNocTable(rows)
    // minutesAgo = id, nên id nhỏ là mới hơn.
    assert.deepEqual(table.newest.value.map(r => r.id), [1, 3, 5])
  })

  it('bỏ qua một hàng thì hàng đó rời danh sách nhưng ô tổng KHÔNG đổi', () => {
    const rows = ref<NocRow[]>([row(1, 'error', 4), row(2, 'info', 6)])
    const table = useAnalyticsNocTable(rows)

    assert.equal(table.summary.value.totalEvents, 10)
    assert.equal(table.summary.value.warningErrorEvents, 4)

    table.dismissRow(1)

    assert.deepEqual(table.filtered.value.map(r => r.id), [2], 'hàng đã bỏ qua phải rời danh sách')
    assert.equal(table.summary.value.totalEvents, 10,
      'ô tổng đọc toàn bộ sự kiện — bỏ qua một hàng là lựa chọn hiển thị, không phải sự cố đã hết')
    assert.equal(table.summary.value.warningErrorEvents, 4,
      'ẩn một dòng lỗi khỏi mắt mình không được làm con số lỗi tụt xuống')
  })

  it('lọc theo mức độ cũng không đổi ô tổng', () => {
    const rows = ref<NocRow[]>([row(1, 'error', 3), row(2, 'info', 7), row(3, 'warning', 5)])
    const table = useAnalyticsNocTable(rows)

    table.toggleSeverityFilter()

    assert.deepEqual(table.filtered.value.map(r => r.id), [1, 3])
    assert.equal(table.summary.value.totalEvents, 15)
    assert.equal(table.summary.value.warningErrorEvents, 8)
  })

  /**
   * `warningErrorEvents` phải dùng **cùng** phép kiểm mức độ với bộ lọc.
   * Trước đây ô tổng viết lại regex đó lần thứ hai ngay trong component, nên hai
   * chỗ có thể nhận những mức độ khác nhau mà không có gì báo.
   */
  it('ô tổng và bộ lọc nhận cùng một tập mức độ', () => {
    const severities = ['warn', 'warning', 'error', 'critical', 'WARNING']
    const rows = ref<NocRow[]>(severities.map((s, i) => row(i + 1, s, 1)))
    const table = useAnalyticsNocTable(rows)

    table.toggleSeverityFilter()

    assert.equal(table.filtered.value.length, severities.length)
    assert.equal(table.summary.value.warningErrorEvents, severities.length,
      'một mức độ mà bộ lọc nhận thì ô tổng cũng phải đếm')
  })

  it('bật bộ lọc thì quay về trang 1', () => {
    const rows = ref<NocRow[]>(Array.from({ length: NOC_PAGE_SIZE * 3 }, (_, i) => row(i + 1, 'info')))
    const table = useAnalyticsNocTable(rows)

    table.page.value = 3
    table.toggleSeverityFilter()

    assert.equal(table.page.value, 1,
      'giữ trang 3 trên một tập đã lọc là hiện một bảng trống — đọc ra là không có cảnh báo nào')
  })

  /**
   * `await nextTick()` là bắt buộc, không phải cho gọn: `watch` của Vue chạy
   * **sau** lượt cập nhật, nên ngay sau phép gán thì trang vẫn là trang cũ. Đây
   * cũng đúng là hành vi trong component thật — người xem thấy trang nhảy về 1 ở
   * khung hình kế tiếp, không phải trong cùng một tick.
   */
  it('dữ liệu mới về thì quay về trang 1', async () => {
    const rows = ref<NocRow[]>(Array.from({ length: NOC_PAGE_SIZE * 3 }, (_, i) => row(i + 1, 'info')))
    const table = useAnalyticsNocTable(rows)

    table.page.value = 2
    rows.value = [row(99, 'info')]
    await nextTick()

    assert.equal(table.page.value, 1)
  })

  it('chia trang đúng số hàng mỗi trang', () => {
    const rows = ref<NocRow[]>(Array.from({ length: NOC_PAGE_SIZE + 3 }, (_, i) => row(i + 1, 'info')))
    const table = useAnalyticsNocTable(rows)

    assert.equal(table.totalPages.value, 2)
    assert.equal(table.pageRows.value.length, NOC_PAGE_SIZE)

    table.page.value = 2
    assert.equal(table.pageRows.value.length, 3)
  })

  /** Danh sách rỗng phải ra 1 trang, không phải 0 — trang 0 không tồn tại. */
  it('danh sách rỗng vẫn là một trang', () => {
    const table = useAnalyticsNocTable(ref<NocRow[]>([]))
    assert.equal(table.totalPages.value, 1)
    assert.equal(table.summary.value.latestStatus, 'Không có sự kiện')
    assert.equal(table.summary.value.maxDuration, 0)
  })

  it('mở rộng một hàng rồi bỏ qua chính hàng đó thì đóng lại', () => {
    const rows = ref<NocRow[]>([row(1, 'error'), row(2, 'info')])
    const table = useAnalyticsNocTable(rows)

    table.toggleRow(1)
    assert.equal(table.expandedId.value, 1)

    table.dismissRow(1)
    assert.equal(table.expandedId.value, null,
      'giữ id đã mở của một hàng vừa biến mất là để lại một khối chi tiết không thuộc hàng nào')
  })

  it('bỏ qua tất cả rồi hoàn lại thì danh sách trở về nguyên vẹn', () => {
    const rows = ref<NocRow[]>([row(1, 'error'), row(2, 'info')])
    const table = useAnalyticsNocTable(rows)

    table.dismissRow(1)
    table.dismissRow(2)
    assert.equal(table.filtered.value.length, 0)

    table.undismissAll()
    assert.equal(table.filtered.value.length, 2)
  })

  /** Nhận `undefined` (lượt fetch chưa về) mà không nổ. */
  it('chưa có dữ liệu thì không nổ', () => {
    const source = computed<NocRow[] | undefined>(() => undefined)
    const table = useAnalyticsNocTable(source)
    assert.deepEqual(table.pageRows.value, [])
    assert.equal(table.summary.value.totalEvents, 0)
  })
})

/**
 * Bảng NOC không được in dữ liệu định danh ra màn hình quản trị.
 *
 * `safeDetails` là lưới an toàn cuối cho một bảng chẩn đoán mà **nhiều nguồn
 * khác nhau cùng ghi vào**, nên nội dung `details` không có lược đồ cố định.
 * Trước đây nó nằm trong `<script setup>` của một SFC 996 dòng, tức là không
 * nơi nào import được và cách duy nhất để kiểm là mount cả bảng điều khiển —
 * nên trên thực tế nó **chưa từng được kiểm**.
 *
 * Đó là kiểu hỏng tệ nhất cho một danh sách chặn: một danh sách ngừng chặn
 * trông y hệt một danh sách đang chạy đúng. Không có gì đỏ, không có gì thiếu
 * trên màn hình — chỉ có thêm một trường lẽ ra không nên ở đó.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isWarningOrError, safeDetails, explainNocEvent } from '../app/utils/analytics-noc.ts'

describe('isWarningOrError', () => {
  it('nhận cả hai cách viết mà các nguồn sự kiện dùng', () => {
    for (const severity of ['warn', 'warning', 'error', 'critical', 'WARNING', 'Error']) {
      assert.equal(isWarningOrError(severity), true, `${severity} phải được coi là đáng chú ý`)
    }
  })

  it('bỏ qua mức bình thường', () => {
    for (const severity of ['info', 'debug', 'ok', '', 'notice']) {
      assert.equal(isWarningOrError(severity), false, `${severity} không phải cảnh báo`)
    }
  })

  /** Khớp toàn chuỗi, không phải khớp một phần: "no-error" không phải lỗi. */
  it('không khớp một phần chuỗi', () => {
    assert.equal(isWarningOrError('no-error'), false)
    assert.equal(isWarningOrError('error-free'), false)
  })
})

describe('safeDetails lọc được trường định danh', () => {
  /**
   * Từng nhóm một, để khi test đỏ thì thông báo chỉ thẳng vào loại dữ liệu đã
   * lọt ra — chứ không chỉ nói "bộ lọc hỏng".
   */
  const MUST_BE_REMOVED: Array<[string, Record<string, string>]> = [
    ['địa chỉ IP', { clientIp: '203.0.113.7', path: '/news' }],
    ['token khách', { visitorToken: 'abc123', count: '5' as unknown as string }],
    ['email', { userEmail: 'nguoidan@example.com', status: 'ok' }],
    ['số điện thoại', { phoneNumber: '0903480985', status: 'ok' }],
    ['phiên', { sessionId: 'uuid-here', status: 'ok' }],
    ['cookie', { cookieHeader: 'cdkt_admin=…', status: 'ok' }],
    ['địa chỉ', { addressLine: '12 Trần Phú', status: 'ok' }],
    ['uỷ quyền', { authorization: 'Bearer …', status: 'ok' }],
  ]

  for (const [label, details] of MUST_BE_REMOVED) {
    it(`loại ${label} khỏi chuỗi hiển thị`, () => {
      const output = safeDetails(details)
      const secret = Object.entries(details).find(([key]) =>
        /(visitor|token|cookie|session|email|phone|address|ip|user|authorization)/i.test(key))![1]
      assert.ok(!output.includes(String(secret)),
        `${label} lọt ra màn hình quản trị: ${output}`)
    })
  }

  it('giữ lại trường chẩn đoán vô hại', () => {
    const output = safeDetails({ path: '/news', count: 12 as unknown as string, status: 'ok' })
    assert.ok(output.includes('/news'))
    assert.ok(output.includes('12'))
    assert.ok(output.includes('ok'))
  })

  /**
   * `—` chứ không phải `{}`: một cặp ngoặc trống đọc ra là dữ liệu bị mất, còn
   * dấu gạch đọc ra là "không có gì để hiện". Hai thứ đó khác nhau với người
   * đang tìm nguyên nhân một sự cố.
   */
  it('rỗng và null đều ra dấu gạch, không phải ngoặc trống', () => {
    assert.equal(safeDetails(null), '—')
    assert.equal(safeDetails({}), '—')
    assert.equal(safeDetails({ clientIp: '1.2.3.4' }), '—',
      'lọc hết thì phải ra dấu gạch, không phải một object rỗng')
  })
})

describe('explainNocEvent giải thích sự kiện vận hành rõ ràng', () => {
  it('giải thích đúng cảnh báo ingestion_rejected với invalid_payload', () => {
    const res = explainNocEvent({
      eventType: 'ingestion_rejected',
      errorCode: 'invalid_payload',
      status: 'rejected',
      severity: 'warning',
    })
    assert.equal(res.tone, 'warning')
    assert.ok(res.title.includes('Từ chối'))
    assert.ok(res.cause.includes('không hợp lệ'))
    assert.ok(res.impact.includes('An toàn'))
    assert.ok(res.action.includes('Đánh dấu đã xử lý'))
  })

  it('giải thích đúng cảnh báo retention_cleanup với retention_warning', () => {
    const res = explainNocEvent({
      eventType: 'retention_cleanup',
      errorCode: 'retention_warning',
      status: 'warning',
      severity: 'warning',
    })
    assert.equal(res.tone, 'warning')
    assert.ok(res.title.includes('trần mẻ an toàn') || res.title.includes('Retention'))
    assert.ok(res.cause.includes('không khóa bảng MySQL'))
    assert.ok(res.impact.includes('an toàn'))
    assert.ok(res.action.includes('Đánh dấu đã xử lý'))
  })

  it('giải thích đúng cảnh báo maintenance_warning với retention_warning', () => {
    const res = explainNocEvent({
      eventType: 'maintenance_warning',
      errorCode: 'retention_warning',
      status: 'warning',
      severity: 'warning',
      details: { processedDays: 3, stale: false },
    })
    assert.equal(res.tone, 'warning')
    assert.ok(res.title.includes('Bảo trì dữ liệu định kỳ') || res.title.includes('Chạm trần'))
    assert.ok(res.cause.includes('3 ngày'))
    assert.ok(res.impact.includes('An toàn'))
    assert.ok(res.action.includes('Đánh dấu đã xử lý'))
  })

  it('phân biệt lỗi nghiêm trọng maintenance_failure', () => {
    const res = explainNocEvent({
      eventType: 'maintenance_failure',
      errorCode: 'maintenance_failed',
      status: 'failure',
      severity: 'error',
    })
    assert.equal(res.tone, 'danger')
    assert.ok(res.cause.includes('thất bại'))
    assert.ok(res.action.includes('npm run analytics:maintenance'))
  })

  it('an toàn khi thiếu trường hoặc sự kiện không xác định', () => {
    const res = explainNocEvent({})
    assert.ok(res.title)
    assert.ok(res.cause)
    assert.ok(res.impact)
    assert.ok(res.action)
    assert.ok(['info', 'warning', 'danger'].includes(res.tone))
  })
})

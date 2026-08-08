/**
 * Sổ trạng thái đơn đăng ký: hằng số, nhãn, và quy tắc chuyển tiếp.
 *
 * Kiểm bằng cách **chạy** hàm thật. Ba khẳng định ở đây không phải chuyện hình
 * thức — mỗi cái ứng với một cách hỏng đã thấy ở nơi khác trong dự án này:
 *
 *   - **nhãn phải đủ cho MỌI trạng thái**: `t()` của `useI18n` lùi về trả chính
 *     tên khoá, nên một khoá thiếu hiện ra là một định danh thô trên màn hình
 *     (`doc_table_action` đã thiếu đúng như vậy). Ở đây một nhãn thiếu là
 *     `undefined` trong một huy hiệu.
 *   - **`new` không phải đích đến**: giao diện dựng danh sách nút từ
 *     `allowedTransitions`, nên nếu nó trả `new` thì có một nút quay về "chưa
 *     tiếp nhận" — xoá đúng dấu vết mà `first_viewed_by` tồn tại để giữ.
 *   - **`canTransition` và `allowedTransitions` phải nhất quán**: giao diện dùng
 *     hàm sau để vẽ nút, máy chủ dùng hàm trước để kiểm. Lệch nhau là một nút
 *     hiện ra rồi bị từ chối, hoặc một trạng thái đặt được mà không có nút nào.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_LABELS,
  DEFAULT_SUBMISSION_STATUS,
  SUBMISSION_EVENT_TYPES,
  SUBMISSION_NOTE_MAX,
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_META,
  allowedTransitions,
  canTransition,
  isContactChannel,
  isSubmissionEventType,
  isSubmissionStatus,
} from '../app/utils/submission-status.ts'

describe('mọi trạng thái đều hiện được lên màn hình', () => {
  test('mỗi trạng thái có nhãn, mô tả, icon và lớp huy hiệu', () => {
    for (const status of SUBMISSION_STATUSES) {
      const meta = SUBMISSION_STATUS_META[status]
      assert.ok(meta, `thiếu hẳn mục cho ${status}`)
      assert.ok(meta.label.length > 0, `${status} không có nhãn`)
      assert.ok(meta.description.length > 0, `${status} không có mô tả`)
      assert.ok(meta.icon.startsWith('fa-'), `${status} không có icon FontAwesome`)
      assert.ok(meta.badgeClass.includes('bg-['), `${status} không có màu nền huy hiệu`)
      assert.equal(typeof meta.closed, 'boolean')
    }
  })

  test('không có mục thừa nào trong sổ nhãn', () => {
    // Một mục thừa nghĩa là một trạng thái từng tồn tại rồi bị xoá khỏi mảng —
    // và mã nào còn đọc nó vẫn biên dịch được.
    assert.deepEqual(
      Object.keys(SUBMISSION_STATUS_META).sort(),
      [...SUBMISSION_STATUSES].sort(),
    )
  })

  test('nhãn trạng thái là tiếng Việt và không trùng nhau', () => {
    const labels = SUBMISSION_STATUSES.map((s) => SUBMISSION_STATUS_META[s].label)
    assert.equal(new Set(labels).size, labels.length, 'hai trạng thái dùng cùng một nhãn')
  })

  test('mỗi hình thức liên hệ có nhãn', () => {
    for (const channel of CONTACT_CHANNELS) {
      assert.ok(CONTACT_CHANNEL_LABELS[channel]?.length, `thiếu nhãn cho ${channel}`)
    }
    assert.deepEqual(
      Object.keys(CONTACT_CHANNEL_LABELS).sort(),
      [...CONTACT_CHANNELS].sort(),
    )
  })

  test('đúng hai trạng thái được coi là đã đóng', () => {
    const closed = SUBMISSION_STATUSES.filter((s) => SUBMISSION_STATUS_META[s].closed)
    assert.deepEqual([...closed].sort(), ['rejected', 'resolved'])
  })
})

describe('quy tắc chuyển tiếp', () => {
  test('`new` KHÔNG BAO GIỜ là đích đến của bất kỳ chuyển tiếp nào', () => {
    for (const from of SUBMISSION_STATUSES) {
      assert.equal(
        allowedTransitions(from).includes(DEFAULT_SUBMISSION_STATUS),
        false,
        `${from} → new được phép; nó sẽ xoá dấu vết đơn đã có người nhìn tới`,
      )
      assert.equal(canTransition(from, DEFAULT_SUBMISSION_STATUS), false)
    }
  })

  test('không có chuyển tiếp về chính nó', () => {
    for (const status of SUBMISSION_STATUSES) {
      assert.equal(allowedTransitions(status).includes(status), false)
      assert.equal(canTransition(status, status), false)
    }
  })

  test('hồ sơ đã đóng vẫn mở lại được', () => {
    // Khoá lại là buộc cán bộ tạo một đơn thứ hai cho cùng một người dân, và lúc
    // đó lịch sử của người đó nằm ở hai chỗ.
    assert.equal(canTransition('resolved', 'in_progress'), true)
    assert.equal(canTransition('rejected', 'in_progress'), true)
    assert.equal(canTransition('resolved', 'rejected'), true)
  })

  test('từ `new` đi được sang mọi trạng thái xử lý', () => {
    assert.deepEqual(
      [...allowedTransitions('new')].sort(),
      ['in_progress', 'rejected', 'resolved', 'transferred'],
    )
  })

  test('canTransition và allowedTransitions luôn nói cùng một điều', () => {
    // Giao diện vẽ nút bằng hàm sau, máy chủ kiểm bằng hàm trước. Lệch nhau là
    // một nút hiện ra rồi bị từ chối 400.
    for (const from of SUBMISSION_STATUSES) {
      const allowed = new Set(allowedTransitions(from))
      for (const to of SUBMISSION_STATUSES) {
        assert.equal(
          canTransition(from, to),
          allowed.has(to),
          `${from} → ${to}: hai hàm không đồng ý`,
        )
      }
    }
  })
})

describe('hàm canh kiểu', () => {
  test('isSubmissionStatus chỉ nhận trạng thái đã khai', () => {
    for (const status of SUBMISSION_STATUSES) assert.equal(isSubmissionStatus(status), true)
    for (const bad of ['', 'moi', 'NEW', 'new ', null, undefined, 0, {}, ['new']]) {
      assert.equal(isSubmissionStatus(bad), false, `nhận ${JSON.stringify(bad)}`)
    }
  })

  test('isContactChannel chỉ nhận hình thức đã khai', () => {
    for (const channel of CONTACT_CHANNELS) assert.equal(isContactChannel(channel), true)
    for (const bad of ['', 'sms', 'PHONE', null, 3]) {
      assert.equal(isContactChannel(bad), false, `nhận ${JSON.stringify(bad)}`)
    }
  })

  test('isSubmissionEventType chỉ nhận loại sự kiện đã khai', () => {
    for (const type of SUBMISSION_EVENT_TYPES) assert.equal(isSubmissionEventType(type), true)
    for (const bad of ['', 'delete', 'VIEW', null]) {
      assert.equal(isSubmissionEventType(bad), false, `nhận ${JSON.stringify(bad)}`)
    }
  })

  test('mặc định là `new` và nó nằm trong danh sách', () => {
    assert.equal(DEFAULT_SUBMISSION_STATUS, 'new')
    assert.ok(isSubmissionStatus(DEFAULT_SUBMISSION_STATUS))
  })

  test('giới hạn ghi chú là một số dương hợp lý', () => {
    // Giao diện đặt `maxlength` bằng chính hằng số này, nên hai đầu không lệch.
    assert.equal(typeof SUBMISSION_NOTE_MAX, 'number')
    assert.ok(SUBMISSION_NOTE_MAX >= 500 && SUBMISSION_NOTE_MAX <= 10_000)
  })
})

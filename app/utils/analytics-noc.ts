/**
 * Hai phép biến đổi thuần của bảng NOC trong màn hình analytics.
 *
 * Rút khỏi `AnalyticsLiveDashboard.client.vue` (996 dòng) không phải để đếm
 * dòng, mà vì **`safeDetails` là một bộ lọc quyền riêng tư và nó đang không có
 * test nào**: nằm trong `<script setup>` của một SFC thì không nơi nào import
 * được, nên cách duy nhất để kiểm là mount cả bảng điều khiển. Một danh sách
 * chặn im lặng ngừng chặn trông y hệt một danh sách chặn đang chạy đúng.
 *
 * Phần còn lại của bảng NOC **cố ý ở nguyên chỗ cũ**: template của nó dùng 22
 * định danh của component cha (đồng hồ, trạng thái kết nối, bộ đếm poll dùng
 * chung với hai panel kia). Đẩy 22 thứ đó qua props/emit là **tăng** bề mặt
 * phức tạp để giảm số dòng — đổi một tệp dài lấy hai tệp buộc nhau chặt hơn.
 */

/** Mức độ nào đáng để cán bộ chú ý. Chấp nhận cả `warn` lẫn `warning` vì hai
 *  nguồn sự kiện dùng hai cách viết. */
export function isWarningOrError(severity: string): boolean {
  return /^(warning|warn|error|critical)$/i.test(severity)
}

/**
 * Chuỗi JSON của `details`, đã loại các khoá có thể mang dữ liệu định danh.
 *
 * Đây là **danh sách chặn theo tên khoá**, và giới hạn đó là chủ đích: bảng NOC
 * hiển thị chẩn đoán do nhiều nguồn ghi ra, nên không có lược đồ cố định để
 * duyệt theo danh sách cho phép. Chặn theo tên bắt được đúng nhóm trường mà một
 * người ghi log sẽ đặt tên như vậy (`visitorToken`, `clientIp`, `userEmail`) —
 * nó **không** bắt được một giá trị định danh nấp dưới một cái tên vô hại, và
 * cũng không nhằm làm thế. Tuyến phòng thủ thật là không ghi dữ liệu đó vào
 * `details` ngay từ đầu; cái này là lưới an toàn cuối.
 *
 * Rỗng sau khi lọc thì trả `—` chứ không phải `{}`: một cặp ngoặc trống nhìn
 * như dữ liệu bị mất, còn dấu gạch đọc ra là "không có gì để hiện".
 */
export function safeDetails(details: Record<string, number | boolean | string> | null): string {
  if (!details) return '—'
  const blocked = /(visitor|token|cookie|session|email|phone|address|ip|user|authorization)/i
  const safe = Object.fromEntries(Object.entries(details).filter(([key]) => !blocked.test(key)))
  return Object.keys(safe).length ? JSON.stringify(safe) : '—'
}

export interface NocExplanation {
  title: string
  cause: string
  impact: string
  action: string
  tone: 'info' | 'warning' | 'danger'
}

/**
 * Giải thích chi tiết, nguyên nhân, đánh giá mức độ và hướng xử lý cho từng sự kiện/cảnh báo NOC.
 * Hàm thuần túy, không phụ thuộc DOM, dễ dàng viết unit test độc lập.
 */
export function explainNocEvent(event: {
  eventType?: string
  status?: string
  errorCode?: string
  severity?: string
  details?: Record<string, unknown> | null
}): NocExplanation {
  const type = String(event.eventType || '').toLowerCase()
  const code = String(event.errorCode || '').toLowerCase()
  const status = String(event.status || '').toLowerCase()
  const details = event.details || {}
  const isStale = details.stale === true
  const processedDays = typeof details.processedDays === 'number' ? details.processedDays : null

  // 1. Gói tin bị từ chối
  if (type === 'ingestion_rejected') {
    if (code === 'invalid_payload') {
      return {
        title: 'Từ chối gói tin phân tích không hợp lệ (Input Validation)',
        cause: 'API thu thập lượt truy cập (/api/public/analytics/view) nhận được gói tin thống kê gửi lên từ trình duyệt có dữ liệu không hợp lệ (thiếu trường bắt buộc, sai định dạng URL hoặc sai chữ ký bảo mật HMAC).',
        impact: 'An toàn. Cơ chế tự vệ của hệ thống đã chủ động loại bỏ gói tin sai định dạng, ngăn chặn dữ liệu rác hoặc dữ liệu giả mạo ghi vào CSDL.',
        action: 'Bình thường không cần can thiệp kỹ thuật (nhấn "Đánh dấu đã xử lý"). Nếu xuất hiện liên tục hàng nghìn lượt/phút, hãy kiểm tra nguy cơ bot đang quét dò endpoint.',
        tone: 'warning',
      }
    }
    if (code === 'transaction_failed') {
      return {
        title: 'Lỗi ghi nhận lượt truy cập vào CSDL',
        cause: 'Giao dịch ghi nhận thông tin phân tích vào bảng tạm thất bại, thường do kết nối MySQL bị gián đoạn hoặc bị nghẽn khóa ghi (lock timeout).',
        impact: 'Có thể bị thiếu hụt một số lượt xem thống kê thời gian thực trong thời điểm xảy ra sự cố.',
        action: 'Kiểm tra tài nguyên máy chủ MySQL (CPU, RAM, số lượng kết nối đang mở) và kiểm tra log lỗi CSDL.',
        tone: 'danger',
      }
    }
    return {
      title: 'Gói tin phân tích bị từ chối',
      cause: `Hệ thống từ chối xử lý gói tin thu thập phân tích (Mã lỗi: ${code || 'không rõ'}).`,
      impact: 'Dữ liệu không hợp lệ đã được chặn an toàn, không ảnh hưởng CSDL.',
      action: 'Kiểm tra chi tiết kỹ thuật bên dưới và bấm "Đánh dấu đã xử lý".',
      tone: 'warning',
    }
  }

  // 2. Dọn dẹp dữ liệu lưu trữ (retention)
  if (type === 'retention_cleanup') {
    if (code === 'retention_warning' || status === 'warning') {
      return {
        title: 'Dọn dẹp dữ liệu lưu trữ đạt trần mẻ an toàn (Retention Bounded)',
        cause: 'Số lượng bản ghi cũ cần xóa vượt quá hạn mức tối đa cho phép của một lượt chạy bảo trì. Hệ thống chủ động dừng mẻ tại ngưỡng an toàn để không khóa bảng MySQL và không làm chậm trải nghiệm của người dùng trên cổng thông tin.',
        impact: 'Hoàn toàn an toàn. Dữ liệu chưa kịp xóa trong lượt này sẽ được tự động xóa tiếp ở các chu kỳ bảo trì sau; dữ liệu báo cáo không bị ảnh hưởng.',
        action: 'Không cần can thiệp kỹ thuật. Bấm nút "Đánh dấu đã xử lý" bên dưới để hoàn tất đối soát.',
        tone: 'warning',
      }
    }
    return {
      title: 'Dọn dẹp dữ liệu cũ quá hạn thành công',
      cause: 'Tiến trình tự động dọn dẹp các bucket thời gian thực, bảng chống trùng lặp và nhật ký cũ theo đúng chính sách lưu trữ (retention policy).',
      impact: 'Tốt. Giải phóng dung lượng CSDL và duy trì hiệu năng truy vấn tối ưu cho hệ thống.',
      action: 'Hệ thống vận hành bình thường, không cần xử lý.',
      tone: 'info',
    }
  }

  // 3. Cảnh báo bảo trì định kỳ
  if (type === 'maintenance_warning') {
    if (code === 'retention_warning') {
      const daysInfo = processedDays != null ? ` (đã tổng hợp thành công ${processedDays} ngày số liệu)` : ''
      return {
        title: 'Bảo trì dữ liệu định kỳ hoàn tất — Chạm trần mẻ dọn dẹp',
        cause: `Tiến trình bảo trì định kỳ đã tổng hợp đầy đủ số liệu phân tích${daysInfo}, dữ liệu tươi mới (không bị trễ). Riêng bước dọn dẹp các bản ghi cũ đạt trần an toàn của mẻ chạy nên hệ thống phát cảnh báo thông tin.`,
        impact: 'An toàn tuyệt đối. Số liệu thống kê vẫn chính xác 100%. Phần dữ liệu rác còn lại sẽ tự động dọn tiếp ở lượt chạy kế tiếp.',
        action: 'Bình thường không cần can thiệp. Bấm "Đánh dấu đã xử lý" để ghi nhận.',
        tone: 'warning',
      }
    }
    if (isStale) {
      return {
        title: 'Dữ liệu phân tích chậm cập nhật (Stale Data)',
        cause: 'Tiến trình tổng hợp số liệu theo ngày chưa được kích hoạt đúng lịch định kỳ, khiến số liệu thống kê bị trễ so với thời gian thực.',
        impact: 'Các biểu đồ thống kê ngày có thể chưa phản ánh đầy đủ số liệu mới nhất.',
        action: 'Chạy thủ công lệnh "npm run analytics:maintenance" trên máy chủ hoặc kiểm tra cronjob/tiến trình bảo trì ngầm.',
        tone: 'warning',
      }
    }
    return {
      title: 'Cảnh báo vận hành trong tiến trình bảo trì',
      cause: `Tiến trình bảo trì ghi nhận cảnh báo với mã ${code || 'không rõ'}.`,
      impact: 'Tiến trình vẫn tiếp tục chạy và đã xử lý các phần việc chính.',
      action: 'Kiểm tra chi tiết kỹ thuật bên dưới và bấm "Đánh dấu đã xử lý".',
      tone: 'warning',
    }
  }

  // 4. Lỗi bảo trì thất bại
  if (type === 'maintenance_failure') {
    return {
      title: 'Lỗi tiến trình bảo trì định kỳ (Maintenance Failure)',
      cause: `Tiến trình tổng hợp hoặc tối ưu dữ liệu phân tích thất bại (Mã lỗi: ${code || 'maintenance_failed'}). Thường do lỗi kết nối CSDL, xung đột khóa hoặc lỗi truy vấn tổng hợp.`,
      impact: 'Số liệu phân tích theo ngày chưa được tổng hợp đầy đủ. Biểu đồ thống kê có thể chưa cập nhật.',
      action: 'Kiểm tra trạng thái CSDL MySQL, xem log máy chủ và chạy lại lệnh "npm run analytics:maintenance".',
      tone: 'danger',
    }
  }

  // 5. Xung đột khóa bảo trì
  if (type === 'maintenance_lock_contention') {
    return {
      title: 'Xung đột khóa bảo trì (Lock Contention)',
      cause: 'Tiến trình bảo trì không lấy được khóa độc quyền do đang có một tiến trình bảo trì khác đang thực thi song song.',
      impact: 'An toàn. Khóa phân tán chủ động ngăn chặn 2 tác vụ chạy đè lên nhau gây sai lệch dữ liệu.',
      action: 'Không cần can thiệp. Lượt chạy sau sẽ tự động thực hiện khi khóa được giải phóng.',
      tone: 'warning',
    }
  }

  // 6. Hoàn tất bảo trì
  if (type === 'maintenance_complete') {
    const daysInfo = processedDays != null ? ` Đã tổng hợp thành công ${processedDays} ngày số liệu.` : ''
    return {
      title: 'Bảo trì dữ liệu định kỳ hoàn tất thành công',
      cause: `Tiến trình bảo trì tổng hợp số liệu và dọn dẹp CSDL đã chạy thành công trọn vẹn.${daysInfo}`,
      impact: 'Tốt. Dữ liệu phân tích được cập nhật mới nhất, CSDL được tối ưu hóa.',
      action: 'Hệ thống vận hành trơn tru, không cần thao tác.',
      tone: 'info',
    }
  }

  // 7. Lọc bot/crawler
  if (type === 'ingestion_bot_filtered') {
    return {
      title: 'Lọc lượt truy cập tự động từ Bot / Crawler',
      cause: 'Hệ thống phát hiện lượt truy cập xuất phát từ bot tìm kiếm (Googlebot, Bingbot...) hoặc công cụ quét tự động.',
      impact: 'Bình thường. Lượt truy cập bot được tách riêng để không làm sai lệch số liệu người dùng thật.',
      action: 'Cơ chế tự động của hệ thống, không cần xử lý.',
      tone: 'info',
    }
  }

  // 8. Thu thập hợp lệ
  if (type === 'ingestion_accepted') {
    return {
      title: 'Ghi nhận lượt xem thành công',
      cause: 'Gói tin thống kê phân tích hợp lệ và đã được ghi nhận vào bộ đệm thời gian thực.',
      impact: 'Bình thường. Số liệu truy cập đang được tích lũy chính xác.',
      action: 'Không cần thao tác.',
      tone: 'info',
    }
  }

  // 9. Báo cáo thống kê
  if (type === 'reporting_failure') {
    return {
      title: 'Lỗi truy vấn báo cáo thống kê',
      cause: 'Truy vấn tổng hợp số liệu phục vụ màn hình phân tích gặp lỗi hoặc bị quá thời gian chờ (timeout).',
      impact: 'Một số biểu đồ có thể tạm thời hiển thị trống hoặc báo lỗi.',
      action: 'Kiểm tra tài nguyên MySQL và làm mới lại trang sau ít phút.',
      tone: 'danger',
    }
  }
  if (type === 'reporting_success') {
    return {
      title: 'Truy vấn báo cáo thành công',
      cause: 'Dữ liệu tổng hợp báo cáo phân tích đã được trích xuất thành công.',
      impact: 'Bình thường.',
      action: 'Không cần thao tác.',
      tone: 'info',
    }
  }

  // Mặc định
  const isErr = isWarningOrError(event.severity || '')
  return {
    title: isErr ? `Cảnh báo vận hành: ${type}` : `Sự kiện vận hành: ${type}`,
    cause: code && code !== 'none'
      ? `Hệ thống ghi nhận sự kiện ${type} với mã ${code}.`
      : `Ghi nhận sự kiện vận hành thuộc thành phần ${event.status || 'hệ thống'}.`,
    impact: isErr ? 'Cần kiểm tra chi tiết để xác định mức độ ảnh hưởng.' : 'Hoạt động bình thường.',
    action: isErr ? 'Đối soát chi tiết kỹ thuật và bấm "Đánh dấu đã xử lý" sau khi kiểm tra.' : 'Không cần thao tác.',
    tone: isErr ? 'warning' : 'info',
  }
}

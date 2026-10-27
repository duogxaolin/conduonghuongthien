/**
 * Xả cửa sổ gộp báo cáo CSP đang mở khi Nitro tắt (`server/utils/csp-report-log.ts`): các
 * lần lặp đã đếm từ lần xả trước được ghi thành dòng `kind: "repeats"` thay vì mất theo tiến
 * trình. Hẹn giờ của cửa sổ đã `unref`, nên không có gì khác phải dọn. Không đọc cấu hình
 * lúc khởi động, nên thứ tự plugin không ảnh hưởng.
 */
import { cspViolationLog } from '../utils/csp-report-log'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => {
    cspViolationLog.flush()
  })
})

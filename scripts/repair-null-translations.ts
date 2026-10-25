import { runNullLiteralRepair } from '../server/services/translation-null-repair'
import { closeDb } from '../server/utils/db'

/**
 * Xoá chữ "null"/"undefined" bị lưu nhầm làm bản dịch giao diện (`lang_translations.value`)
 * — lỗi của trang "Bản dịch UI" trước bản vá: bấm "Lưu" trên một ô trống chưa sửa thì
 * máy chủ lưu chữ "null", và trang công khai hiện đúng chữ đó. Hàng được đưa về trạng
 * thái "chưa dịch" (NULL), như một khoá mới sau "Đồng bộ key".
 *
 *   npm run db:repair-null-translations            # xem trước: liệt kê hàng sẽ đổi, KHÔNG ghi
 *   npm run db:repair-null-translations -- --apply # ghi
 *
 * Chỉ nhận đúng hai chữ `null`/`undefined` (viết thường, không khoảng trắng). Hàng có
 * người vừa lưu bản dịch thật giữa lúc đọc và lúc ghi thì không đè (`skipped`).
 * `updated_at` giữ nguyên. Chạy lại được: lượt sau không còn gì để đổi. Chỉ hoàn tác
 * được bằng bản sao lưu — sao lưu DB trước khi `--apply` (`scripts/backup-db.sh`).
 * Trên VPS Docker:
 *   docker exec -it cdkt_app npm run db:repair-null-translations -- --apply
 */
const apply = process.argv.includes('--apply')
const report = await runNullLiteralRepair({ apply })
console.log(JSON.stringify(report, null, 2))
if (!apply && report.changed) {
  console.log('Xem trước thôi — xem danh sách `rows` rồi chạy lại với --apply để ghi.')
}
await closeDb()

import { runTranslationValueRepair } from '../server/services/translation-null-repair'
import { closeDb } from '../server/utils/db'

/**
 * Xoá các bản dịch giao diện (`lang_translations.value`) bị lưu nhầm thành chữ không
 * phải bản dịch — lỗi của các đường ghi trước bản vá (trang "Bản dịch UI" và các đường
 * dịch AI); trang công khai hiện đúng các chữ đó. Hàng được đưa về trạng thái "chưa
 * dịch" (NULL), như một khoá mới sau "Đồng bộ key".
 *
 *   npm run db:repair-null-translations                                   # xem trước: liệt kê, KHÔNG ghi
 *   npm run db:repair-null-translations -- --apply                        # ghi nhóm chắc chắn (`exact`)
 *   npm run db:repair-null-translations -- --apply --include-review       # ghi cả nhóm cần xem (`review`)
 *
 * `exact`: đúng chữ `null`/`undefined` — chắc chắn là lỗi. `review`: `NULL`/` null`/
 * `Undefined`…, `[object Object]`, và số trần khác với bản gốc tiếng Việt — gần như chắc
 * là lỗi nhưng cần người xem danh sách trước. Hàng có người vừa sửa giữa lúc đọc và lúc
 * ghi thì không đè (`skipped`, so theo từng byte). `updated_at` giữ nguyên. Chạy lại
 * được. Chỉ hoàn tác được bằng bản sao lưu — sao lưu DB trước khi `--apply`
 * (`scripts/backup-db.sh`). Trên VPS Docker:
 *   docker exec -it cdkt_app npm run db:repair-null-translations -- --apply
 */
const apply = process.argv.includes('--apply')
const includeReview = process.argv.includes('--include-review')
const report = await runTranslationValueRepair({ apply, includeReview })
console.log(JSON.stringify(report, null, 2))
if (!apply && (report.exact.length || report.review.length)) {
  console.log('Xem trước thôi — xem `exact` và `review` rồi chạy lại với --apply (thêm --include-review để ghi cả `review`).')
} else if (apply && !includeReview && report.review.length) {
  console.log(`Còn ${report.review.length} hàng trong \`review\` chưa ghi — xem danh sách, rồi chạy lại với --apply --include-review nếu đúng.`)
}
await closeDb()

import { runPlainTextFix } from '../server/services/stored-plaintext-decode'
import { closeDb } from '../server/utils/db'

/**
 * Giải mã HTML entity trong `title`/`excerpt` đã lưu của bài viết và bản dịch
 * (`Ng&agrave;y` → `Ngày`), để tìm kiếm SQL khớp chữ người đọc thấy.
 *
 *   npm run db:decode-excerpts            # xem trước: đếm hàng sẽ đổi + danh sách cần xem, KHÔNG ghi
 *   npm run db:decode-excerpts -- --apply # ghi
 *
 * Đọc kỹ `fragments` trước khi `--apply`: mỗi mục là một trường mà kết quả bỏ một
 * đoạn cuối (`… nh&ac` → `… nh…`); một chuỗi kết thúc bằng `&chữ` thật (`AT&T`) cũng
 * rơi vào đây và sẽ bị cắt. `unstable` là các trường KHÔNG ghi (chữ entity viết
 * nguyên văn). `updated_at` giữ nguyên; `content` không bị đọc hay ghi.
 *
 * Chạy lại được: hàng đã sạch thì không đổi. Chỉ hoàn tác được bằng bản sao lưu —
 * sao lưu DB trước khi `--apply` (`scripts/backup-db.sh`). Trên VPS Docker:
 *   docker exec -it cdkt_app npm run db:decode-excerpts -- --apply
 */
const apply = process.argv.includes('--apply')
const report = await runPlainTextFix({ apply })
console.log(JSON.stringify(report, null, 2))
if (!apply && (report.articles.changed || report.translations.changed)) {
  console.log('Xem trước thôi — xem danh sách `fragments` rồi chạy lại với --apply để ghi.')
}
await closeDb()

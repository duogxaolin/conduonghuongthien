import { runStoredHtmlSanitize } from '../server/services/stored-html-sanitize'
import { closeDb } from '../server/utils/db'

/**
 * Dọn HTML đã lưu (bản dịch bài viết, bản dịch khối trang) về dạng đã lọc.
 *
 *   npm run db:sanitize-html            # xem trước: đếm hàng sẽ đổi, KHÔNG ghi
 *   npm run db:sanitize-html -- --apply # ghi
 *
 * Chạy được nhiều lần: hàng đã sạch thì không đổi. Nên sao lưu DB trước khi
 * `--apply` (`scripts/backup-db.sh`). Trên VPS Docker:
 *   docker exec -it cdkt_app npm run db:sanitize-html -- --apply
 */
const apply = process.argv.includes('--apply')
const report = await runStoredHtmlSanitize({ apply })
console.log(JSON.stringify(report))
if (!apply && (report.translations.changed || report.blocks.changed)) {
  console.log('Xem trước thôi — chạy lại với --apply để ghi.')
}
await closeDb()

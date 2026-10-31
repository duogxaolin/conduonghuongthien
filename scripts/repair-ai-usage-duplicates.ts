import { runAiUsageDuplicateRepair } from '../server/services/ai-usage-duplicates-repair'
import { closeDb } from '../server/utils/db'

/**
 * Xoá các hàng `delify_router` mà nút "Đồng bộ" Delify đã nhập vào `ai_usage_logs` trước
 * bản vá 2026-10-31: mỗi hàng chép lại một lượt gọi cổng AI đã ghi rồi, nên chi phí bị
 * cộng hai lần (ngân sách AI, dashboard, thẻ khoá Delify) — và trước R5-8 mỗi lượt đồng bộ
 * còn chèn lại cả lịch sử. Chỉ xoá hàng `delify_router`; không bao giờ đụng hàng do cổng
 * AI hay "Gọi thử" ghi.
 *
 *   npm run db:repair-ai-usage-duplicates                                 # xem trước: liệt kê, KHÔNG ghi
 *   npm run db:repair-ai-usage-duplicates -- --apply                      # xoá nhóm chắc chắn (`exact`)
 *   npm run db:repair-ai-usage-duplicates -- --apply --include-review     # xoá cả nhóm cần xem (`review`)
 *
 * `exact`: hàng có đúng MỘT hàng cổng AI cùng model, cùng số token vào/ra (hoặc token vào
 * + 2000 với hàng ghi trước 24/9/2026), lệch giờ nằm trong dải lệch đồng hồ router — và
 * bản sao y hệt của chính hàng đó. `review`: hàng cổng AI cùng token ra, token vào ít hơn
 * của router 1–256 (`near_twin`), và bản sao y hệt của hàng ngoài `exact`. `kept`: không
 * bao giờ xoá (kèm lý do). Chạy SAU khi bản vá đã deploy (bản cũ bấm "Đồng
 * bộ" sẽ nhập lại). Chạy lại được. Chỉ hoàn tác được bằng bản sao lưu — sao lưu DB trước
 * khi `--apply` (`scripts/backup-db.sh`). Trên VPS Docker:
 *   docker exec -it cdkt_app npm run db:repair-ai-usage-duplicates -- --apply
 */
const apply = process.argv.includes('--apply')
const includeReview = process.argv.includes('--include-review')
try {
  const report = await runAiUsageDuplicateRepair({ apply, includeReview })
  console.log(JSON.stringify(report, null, 2))
  const counts = `exact ${report.exact.length} hàng (${report.costVnd.exact} VND), review ${report.review.length} hàng (${report.costVnd.review} VND), kept ${report.kept.length} hàng (${report.costVnd.kept} VND)`
  if (!apply) {
    console.log(`Xem trước thôi — ${counts}. Đọc \`exact\`, \`review\`, \`kept\` rồi chạy lại với --apply (thêm --include-review để xoá cả \`review\`).`)
  } else {
    console.log(`Đã xoá ${report.written} hàng (${report.skipped} hàng đã không còn). ${counts}.`)
    if (!includeReview && report.review.length) {
      console.log(`Còn ${report.review.length} hàng trong \`review\` chưa xoá — xem danh sách, rồi chạy lại với --apply --include-review nếu đúng.`)
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await closeDb()
}

import mysql from 'mysql2/promise'

/**
 * DDL khởi tạo: dựng CSDL và 62 bảng cho một máy chủ trống, idempotent.
 *
 * Phần **hội tụ lược đồ đã có dữ liệu** (thêm cột còn thiếu, index, khoá ngoại,
 * điền giá trị rồi đặt `NOT NULL`) nằm ở `migrations-additive.ts` — hai việc đó
 * chạy trên hai loại CSDL khác nhau, xem đầu tệp đó để biết vì sao không gộp.
 *
 * Các câu `CREATE TABLE` được tách theo domain vào `schema-tables/*.ts` để
 * `init.ts` chỉ còn giữ thứ tự gọi — thứ tự là ràng buộc FK thật (cha phải tồn
 * tại trước con), không phải sắp lại cho gọn. Cổng `db:drift` đọc cả 9 tệp (init
 * + 7 schema-tables + migrations-additive) như một nguồn DDL duy nhất.
 *
 * Re-export nguyên vẹn `migrations-additive` để bốn suite test đang import từ
 * tệp này không phải đổi đường dẫn; `initDb()` bên dưới gọi `applyAdditiveMigrations`
 * như trước.
 */
export * from './migrations-additive'
import { applyAdditiveMigrations } from './migrations-additive'
import { createCoreTables } from './schema-tables/core'
import { createContentTables } from './schema-tables/content'
import { createGovernanceTables } from './schema-tables/governance'
import { createChatbotTables } from './schema-tables/chatbot'
import { createAnalyticsTables } from './schema-tables/analytics'
import { createReadersMediaTables } from './schema-tables/readers-media'
import { createAiI18nTables } from './schema-tables/ai-i18n'

export async function initDb() {
  console.log('🔄 Checking & Creating MySQL tables...')

  const host     = process.env.DB_HOST     || '127.0.0.1'
  const port     = Number(process.env.DB_PORT || 3306)
  const user     = process.env.DB_USER     || 'root'
  const password = process.env.DB_PASSWORD || ''
  const database = process.env.DB_NAME     || 'cdkt_admin'

  // Step 1: Connect without database to ensure database exists
  // `finally`: initDb cũng chạy trong tiến trình server (khôi phục CSDL gọi nó) — một
  // bước hỏng không được để lại kết nối mở.
  const connection = await mysql.createConnection({ host, port, user, password })
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
  } finally {
    await connection.end().catch(() => {})
  }

  // Step 2: Connect to target database and create tables in FK order.
  // Mỗi hàm tạo một nhóm bảng theo domain; thứ tự gọi bảo toàn ràng buộc FK
  // (cha trước con) — đúng thứ tự của init.ts cũ trước khi tách.
  const db = await mysql.createConnection({ host, port, user, password, database })
  try {
    await createCoreTables(db, database)
    await createContentTables(db, database)
    await createGovernanceTables(db, database)
    await createChatbotTables(db, database)
    await createAnalyticsTables(db)
    await createReadersMediaTables(db)
    await createAiI18nTables(db)

    // Additive migrations chạy cuối cùng: ensureColumn/FK/index cho DB đã có dữ
    // liệu (bảng tồn tại từ deployment cũ, thiếu cột mới). Xem migrations-additive.
    await applyAdditiveMigrations(db, database)
  } finally {
    await db.end().catch(() => {})
  }
  console.log('✅ All MySQL tables exist and ready!')
}

// Chuẩn hoá dấu gạch: trên Windows argv[1] là `...\server\db\init.ts`, nên một
// phép so sánh với dấu gạch xuôi duy nhất khiến script thoát 0 mà KHÔNG HỀ chạy
// initDb() — im lặng, đúng kiểu hỏng mà không lỗi nào báo. Đã gặp thật lúc chạy
// e2e trên checkout Windows: db:init "xong" và db:seed sau đó chết vì thiếu CSDL.
const invokedScript = (process.argv[1] || '').replaceAll('\\', '/')
if (invokedScript.endsWith('server/db/init.ts')) {
  initDb().catch(err => {
    console.error('❌ Init DB failed:', err)
    process.exit(1)
  })
}

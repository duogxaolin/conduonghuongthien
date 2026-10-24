/**
 * Dump và khôi phục CSDL bằng driver `mysql2` — không phụ thuộc `mysqldump`.
 *
 * Lý do không dùng binary: app container (alpine + `mysql-client` = mariadb-client)
 * không có plugin `caching_sha2_password` mà MySQL 8 mặc định dùng, nên
 * `mysqldump` từ app container không kết nối được. Dump sinh SQL text thuần:
 * `DROP TABLE IF EXISTS` + `CREATE TABLE` + `INSERT VALUES` cho mỗi bảng.
 */
import { promises as fs } from 'node:fs'
import type { FieldPacket, RowDataPacket } from 'mysql2'

import { logWarn } from '../utils/logger'
import { DEFAULT_RESTORE_LIMITS, DUMP_FORMAT_MARKER, gunzipFileBounded, isLegacyAppDump } from './backup-restore-guards'

/**
 * Kết nối riêng cho dump/khôi phục, cùng biến môi trường như trước. Pool của app
 * tắt `multipleStatements` và mang `timezone: '+07:00'` (driver tự đổi
 * DATETIME ↔ `Date`); dump và restore cần cấu hình khác nên không mượn kết nối
 * pool — cũng để không để lại `time_zone` phiên trên một kết nối pool.
 *
 *  - `multipleStatements` chỉ cho khôi phục (chạy cả file SQL một lượt).
 *  - `exactValues` cho dump: ngày giờ, BIGINT/DECIMAL và JSON về đúng chuỗi MySQL
 *    trả, không qua `Date`/`Number`/`JSON.parse` của JavaScript.
 */
export async function createBackupConnection(options: { multipleStatements?: boolean; exactValues?: boolean } = {}) {
  const mysql = await import('mysql2/promise')
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'cdkt_admin',
    multipleStatements: options.multipleStatements === true,
    ...(options.exactValues
      ? { dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, jsonStrings: true, decimalNumbers: false }
      : {}),
  })
}

/** Mã kiểu cột số của giao thức MySQL (mysql2 `lib/constants/types.js`). */
const NUMERIC_COLUMN_TYPES = new Set([
  0x00, // DECIMAL
  0x01, // TINYINT
  0x02, // SMALLINT
  0x03, // INT
  0x04, // FLOAT
  0x05, // DOUBLE
  0x08, // BIGINT
  0x09, // MEDIUMINT
  0x0d, // YEAR
  0xf6, // NEWDECIMAL
])
const STRICT_NUMERIC = /^-?\d+(\.\d+)?$/

/**
 * `sql_mode` mà dump được viết cho và được chạy dưới — đúng giá trị mysqldump ghi.
 *
 * `quoteSqlString` thoát `'` thành `\'`. Dưới `NO_BACKSLASH_ESCAPES` (một
 * `sql_mode` server hợp lệ), `\'` là một dấu `\` rồi KẾT THÚC chuỗi — phần còn lại
 * của giá trị do người dùng nhập (tiêu đề bài, nội dung đơn…) trở thành câu lệnh
 * SQL chạy bằng quyền khôi phục. Ghim chế độ ở header (và ở phiên khôi phục) làm
 * file chỉ có MỘT cách đọc, bất kể server đặt gì.
 *
 * `NO_AUTO_VALUE_ON_ZERO`: hàng có `id = 0` trong cột AUTO_INCREMENT được chèn lại
 * đúng là 0 — không có nó MySQL cấp id mới và mọi khoá ngoại trỏ tới 0 gãy.
 * Không thêm gì khác (đặc biệt KHÔNG `NO_BACKSLASH_ESCAPES`).
 */
export const DUMP_SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO'

function quoteSqlString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0').split('\u001a').join('\\Z')}'`
}

/**
 * Giá trị đã là chuỗi đúng như MySQL lưu (xem `exactValues`). Chuỗi của cột số
 * (BIGINT/DECIMAL) chỉ viết trần khi khớp mẫu số chặt — `'007'` trong một cột
 * VARCHAR luôn có nháy, nên không bao giờ mất số 0 đầu. Kiểu bất ngờ (`Date`,
 * object…) là lỗi: thà dump hỏng ồn ào còn hơn lệch dữ liệu im lặng.
 */
function escapeSqlValue(value: unknown, field: FieldPacket | undefined): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`
  if (typeof value === 'string') {
    const columnType = field?.columnType ?? field?.type
    if (columnType !== undefined && NUMERIC_COLUMN_TYPES.has(columnType) && STRICT_NUMERIC.test(value)) return value
    return quoteSqlString(value)
  }
  throw new Error(`Giá trị kiểu ${Object.prototype.toString.call(value)} ở cột ${field?.name ?? '?'} không dump chính xác được.`)
}

export interface DumpHooks {
  /** Gọi sau khi đọc xong mỗi bảng — chỉ để kiểm thử snapshot nhất quán. */
  afterTable?: (table: string) => Promise<void> | void
}

/**
 * Dump CSDL thành SQL text (định dạng 2).
 *
 *  - Kết nối riêng, `time_zone = '+00:00'` cho phiên: TIMESTAMP ra cùng một mốc
 *    bất kể múi giờ mặc định của server; header file cũng đặt `+00:00` nên khôi
 *    phục không phụ thuộc server. DATETIME/DATE là chuỗi nguyên văn.
 *  - Mọi bảng đọc trong MỘT transaction `REPEATABLE READ` + `WITH CONSISTENT
 *    SNAPSHOT`: hai hàng ghi cùng transaction lúc đang dump có mặt cả hai hoặc
 *    không hàng nào. Bảng không phải InnoDB không có bảo đảm đó — ghi cảnh báo.
 */
export async function dumpSql(target: string, hooks: DumpHooks = {}): Promise<number> {
  const conn = await createBackupConnection({ exactValues: true })
  try {
    // Cùng chế độ với lúc khôi phục: `SHOW CREATE TABLE` không in theo
    // `ANSI_QUOTES`, và `PAD_CHAR_TO_FULL_LENGTH` của server không độn CHAR vào dump.
    await conn.query(`SET SESSION sql_mode = '${DUMP_SQL_MODE}'`)
    await conn.query("SET SESSION time_zone = '+00:00'")
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    try {
      const [tables] = await conn.query<RowDataPacket[]>('SHOW TABLES')
      const [engines] = await conn.query<RowDataPacket[]>(
        "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
      )
      const nonInnodb = engines.filter(row => String(row.engine ?? '').toLowerCase() !== 'innodb').map(row => String(row.name))
      if (nonInnodb.length) logWarn({ event: 'backup.dump_non_innodb', tables: nonInnodb })

      const dbName = process.env.DB_NAME || 'cdkt_admin'
      const lines: string[] = [
        `-- CDKT backup: ${dbName}`,
        DUMP_FORMAT_MARKER,
        `-- Generated: ${new Date().toISOString()}`,
        'SET NAMES utf8mb4;',
        `SET SESSION sql_mode = '${DUMP_SQL_MODE}';`,
        "SET time_zone = '+00:00';",
        'SET FOREIGN_KEY_CHECKS=0;',
        '',
      ]
      for (const row of tables) {
        const table = Object.values(row)[0] as string
        // Table name từ SHOW TABLES — an toàn để nhét trực tiếp (không user input).
        const [createRows] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``)
        const createSql = (createRows[0] as Record<string, string>)['Create Table']
        lines.push(`DROP TABLE IF EXISTS \`${table}\`;`)
        lines.push(createSql + ';')
        // Generated columns (`articles.view_total`) are left out, as mysqldump
        // does: MySQL refuses any value for one on INSERT (error 3105), so dumping
        // it would make every backup — the automatic `pre-restore` copy included —
        // impossible to restore; the CREATE TABLE above recomputes it. Matched on
        // the exact EXTRA values: `created_at`/`updated_at` read `DEFAULT_GENERATED`
        // and are ordinary data that must be dumped.
        const [columnRows] = await conn.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
             AND EXTRA NOT IN ('STORED GENERATED', 'VIRTUAL GENERATED')
           ORDER BY ORDINAL_POSITION`,
          [table],
        )
        const columnList = columnRows.map(column => `\`${String(column.name)}\``).join(', ')
        const [rows, fields] = await conn.query<RowDataPacket[][]>({ sql: `SELECT ${columnList} FROM \`${table}\``, rowsAsArray: true })
        if (rows.length > 0 && fields.length > 0) {
          lines.push(`INSERT INTO \`${table}\` (\`${fields.map(field => field.name).join('`, `')}\`) VALUES`)
          const valuesChunks: string[] = []
          for (const values of rows) {
            valuesChunks.push(`(${values.map((value: unknown, index: number) => escapeSqlValue(value, fields[index])).join(', ')})`)
          }
          lines.push(valuesChunks.join(',\n') + ';')
        }
        lines.push('')
        await hooks.afterTable?.(table)
      }
      lines.push('SET FOREIGN_KEY_CHECKS=1;', '')

      const zlib = await import('node:zlib')
      const gzipped = zlib.gzipSync(Buffer.from(lines.join('\n'), 'utf8'), { level: 6 })
      await fs.writeFile(target, gzipped)
      return gzipped.length
    } finally {
      // Chỉ đọc — kết thúc snapshot.
      await conn.query('ROLLBACK').catch(() => {})
    }
  } finally {
    await conn.end()
  }
}

/**
 * Chạy một file `.sql.gz` trên kết nối riêng có `multipleStatements` (không tách
 * statement thủ công — dễ sai khi string literal chứa `;`).
 *
 * Giải nén có trần (`maxSqlBytes`) — không còn `gunzipSync` không giới hạn: một
 * file nhỏ nở ra hàng GB không được làm tràn RAM.
 *
 * Trả `legacyDateShift: true` khi đây là dump do app sinh trước bản vá ngày giờ
 * (ngày giờ trong file sớm 7 giờ) — người gọi đưa vào trạng thái và audit.
 */
export async function restoreSql(filePath: string, maxSqlBytes: number = DEFAULT_RESTORE_LIMITS.maxSqlBytes): Promise<{ legacyDateShift: boolean }> {
  const { data } = await gunzipFileBounded(filePath, maxSqlBytes, true)
  const sqlText = (data ?? Buffer.alloc(0)).toString('utf8')
  const legacyDateShift = isLegacyAppDump(sqlText)

  const conn = await createBackupConnection({ multipleStatements: true })
  try {
    // Trước cả nội dung file: dump cũ (định dạng 1) và file từ nơi khác không có
    // dòng `sql_mode` ở header — chúng cũng không được chạy dưới
    // `NO_BACKSLASH_ESCAPES` của server. File nào tự đặt `sql_mode` (dump mới,
    // mysqldump) thì dòng của nó đè lên dòng này, cùng một giá trị.
    await conn.query(`SET SESSION sql_mode = '${DUMP_SQL_MODE}'`)
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    await conn.query(sqlText)
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
  } finally {
    await conn.end()
  }
  return { legacyDateShift }
}

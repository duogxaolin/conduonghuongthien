/**
 * Lượt chuyển MỘT LẦN lúc khởi động: mã hoá ba bí mật còn nguyên văn trong
 * `settings` (spec settings-secret-storage, design D-SECRETS). Gọi từ
 * `applyAdditiveMigrations` (`migrations-additive.ts`).
 *
 * Tuân luật lượt ghi lúc khởi động (Wave 0): điều kiện kích hoạt là TRẠNG THÁI
 * GIÁ TRỊ — "giá trị khác rỗng và chưa phải envelope" — và chính lượt chuyển xoá
 * điều kiện đó, nên lần khởi động thứ hai không ghi gì. Một lượt chuyển khai báo
 * (declared conversion) cho bộ test nâng cấp lược đồ.
 *
 * Chỉ MÃ HOÁ, không bao giờ giải mã-rồi-mã-hoá-lại:
 *  - giá trị đã là envelope (mở được hay không) → để nguyên. Envelope không mở được
 *    (khoá đã xoay) được BÁO (`db.migration.settings_secret_unreadable`, tên khoá
 *    thôi) và KHÔNG BAO GIỜ bị ghi đè — bản dump trước deploy còn bản cũ;
 *  - không có khoá vật liệu → không ghi gì, báo (`…_no_key`); lần sau có khoá sẽ
 *    chuyển;
 *  - UPDATE có điều kiện `value = <giá trị vừa đọc>`: một lượt lưu từ trang cài
 *    đặt chen giữa không bị lượt chuyển đè.
 *
 * Envelope mới được mở thử TRƯỚC khi ghi: một khoá hỏng không bao giờ biến một mật
 * khẩu đọc được thành một chuỗi không ai mở được.
 *
 * Hai nơi gọi, mỗi nơi tự ghi log theo ngữ cảnh của mình (hàm này không log):
 *  - `applyAdditiveMigrations` lúc khởi động (`db.migration.settings_secret_*`);
 *  - `services/backup-restore.ts` ngay sau một lượt khôi phục CSDL thành công —
 *    bản dump trước 2A mang bí mật nguyên văn về (kiểm chứng 2A, W4).
 */
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { readAffectedRows } from '../utils/affected-rows'
import {
  SETTINGS_SECRET_KEYS,
  isSettingsSecretEnvelope,
  isSettingsSecretKey,
  openSettingsSecret,
  sealSettingsSecret,
  settingsSecretKeyAvailable,
  type SettingsSecretKey,
} from '../utils/settings-secrets'

export interface SettingsSecretConversionReport {
  converted: SettingsSecretKey[]
  /** Envelope không mở được bằng khoá hiện tại — để nguyên, cần nhập lại. */
  needsReentry: SettingsSecretKey[]
  /** Còn nguyên văn nhưng tiến trình không có khoá để mã hoá. */
  skippedNoKey: SettingsSecretKey[]
}

type Executor = Pick<Connection, 'execute'>

export async function convertPlaintextSettingsSecrets(db: Executor, options: { secret?: string } = {}): Promise<SettingsSecretConversionReport> {
  const report: SettingsSecretConversionReport = { converted: [], needsReentry: [], skippedNoKey: [] }
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT `key`, `value` FROM `settings` WHERE `key` IN (?, ?, ?)',
    [...SETTINGS_SECRET_KEYS],
  )
  const keyAvailable = settingsSecretKeyAvailable(options.secret)

  for (const row of rows) {
    const key = String(row.key)
    if (!isSettingsSecretKey(key)) continue
    const value = typeof row.value === 'string' ? row.value : row.value === null ? null : String(row.value)
    if (!value) continue

    if (isSettingsSecretEnvelope(value)) {
      if (openSettingsSecret(key, value, options.secret).state === 'unreadable') report.needsReentry.push(key)
      continue
    }

    if (!keyAvailable) {
      report.skippedNoKey.push(key)
      continue
    }

    const sealed = sealSettingsSecret(key, value, options.secret)
    const check = openSettingsSecret(key, sealed, options.secret)
    if (check.state !== 'sealed' || check.value !== value) {
      // Không thể xảy ra với một khoá hợp lệ; nếu xảy ra thì giữ nguyên văn còn hơn.
      report.skippedNoKey.push(key)
      continue
    }
    const [result] = await db.execute<ResultSetHeader>(
      // So nhị phân: collation mặc định không phân biệt hoa/thường.
      'UPDATE `settings` SET `value` = ? WHERE `key` = ? AND `value` = ? COLLATE utf8mb4_bin',
      [sealed, key, value],
    )
    if (readAffectedRows(result) === 1) report.converted.push(key)
  }
  return report
}

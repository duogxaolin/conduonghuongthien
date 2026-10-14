/**
 * PUT /api/admin/settings/backup
 *
 * Lưu cấu hình backup (công tắc tự động, lịch, retention, Google Drive) vào
 * bảng `settings` (group `backup`). Validate từng giá trị — sai trả 400, không
 * lùi về mặc định (cùng quy tắc `media-portal.put.ts`).
 *
 * `backup_drive_service_account` là JSON key nhạy cảm — lưu plain text trong
 * settings (chưa encrypt để đơn giản; nếu cần encrypt sau, dùng cùng pattern
 * `media-config-service.ts` với nhãn `cdkt-backup-drive-key:v1`). Ô nhập trên
 * trang hiện `********` nếu đã có — gửi `********` lại = giữ nguyên giá trị cũ.
 */
import { getDb } from '../../../utils/db'
import { settings, activityLogs } from '../../../db/schema'
import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'

const ALLOWED_KEYS = new Set([
  'backup_auto_enabled',
  'backup_auto_hour',
  'backup_auto_days',
  'backup_keep_count',
  'backup_drive_enabled',
  'backup_drive_service_account',
  'backup_drive_folder_id',
])

function validateBoolean(key: string, raw: string): string {
  const t = raw.trim().toLowerCase()
  if (['true', '1', 'on', 'yes'].includes(t)) return 'true'
  if (['false', '0', 'off', 'no'].includes(t)) return 'false'
  throw new Error(`${key} phải là true/false`)
}

function validateInt(key: string, raw: string, min: number, max: number): string {
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${key} phải là số nguyên từ ${min} đến ${max}`)
  }
  return String(n)
}

/**
 * Khoá chỉ SuperAdmin được ĐỔI (quyết định của chủ hệ thống, đợt rà soát 2026-10):
 *
 *  - `backup_drive_*` quyết định bản sao CSDL + toàn bộ file đi TỚI ĐÂU. Một người
 *    chỉ có `settings.update` mà đổi được service account / thư mục Drive / công
 *    tắc thì lần backup kế tiếp chép toàn bộ dữ liệu (kể cả hash mật khẩu, bí mật
 *    đã mã hoá) sang Drive của họ.
 *  - `backup_keep_count` quyết định bao nhiêu bản bị XOÁ: đặt 1 rồi bấm "chạy
 *    backup" vài lần là xoá sạch lịch sử backup.
 *
 * Người không phải SuperAdmin vẫn lưu được biểu mẫu (lịch giờ/ngày, bật tự động)
 * miễn là giữ nguyên các giá trị này — cùng cách `settings/index.put.ts` xử lý
 * `tracking_custom_*`. "Giữ nguyên" so trên giá trị HIỆU LỰC (đã chuẩn hoá, có mặc
 * định như `readBackupConfig` trong `services/backup.ts`), không so chuỗi thô: lần
 * lưu đầu tiên trên một CSDL chưa có hàng nào gửi `14`/`false` mặc định và không
 * được phép bị 403.
 */
const SUPERADMIN_ONLY_KEYS = new Set([
  'backup_keep_count',
  'backup_drive_enabled',
  'backup_drive_service_account',
  'backup_drive_folder_id',
])

const DEFAULT_KEEP_COUNT = 14

function effectiveStored(key: string, stored: string | null | undefined): string {
  const raw = (stored ?? '').trim()
  if (key === 'backup_keep_count') return String(Number(raw) || DEFAULT_KEEP_COUNT)
  if (key === 'backup_drive_enabled') return raw === 'true' || raw === '1' ? 'true' : 'false'
  return raw
}

/** Giá trị gửi lên đã chuẩn hoá để so với `effectiveStored`; `null` = không đọc được (để validate báo lỗi). */
function effectiveSubmitted(key: string, raw: string): string | null {
  const text = raw.trim()
  if (key === 'backup_keep_count') {
    const n = Number(text)
    return text !== '' && Number.isSafeInteger(n) ? String(n) : null
  }
  if (key === 'backup_drive_enabled') {
    try { return validateBoolean(key, text) } catch { return null }
  }
  return text
}

function validateDays(raw: string): string {
  let arr: number[]
  try { arr = JSON.parse(raw) } catch { throw new Error('backup_auto_days phải là mảng JSON') }
  if (!Array.isArray(arr)) throw new Error('backup_auto_days phải là mảng')
  for (const d of arr) {
    if (!Number.isSafeInteger(d) || d < 0 || d > 6) throw new Error('ngày trong tuần phải 0-6')
  }
  return JSON.stringify(arr)
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody<Record<string, string>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Body không hợp lệ.' })
  }

  // Validate + build entries.
  type Entry = { key: string; value: string }
  const entries: Entry[] = []
  const oldValues: Record<string, string | null> = {}

  const db = getDb()
  const existing = await db.select().from(settings)
  const existingMap = new Map(existing.map(r => [r.key, r.value]))

  const isSuperAdmin = adminUser?.isSuperAdmin === true

  for (const [key, raw] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) continue // bỏ qua key lạ

    // Khoá chỉ SuperAdmin: giữ nguyên → bỏ qua (không ghi, không 403); đổi mà
    // không phải SuperAdmin → 403 TRƯỚC mọi ghi. So TRƯỚC khi kiểm biên để một
    // giá trị cũ ngoài biên mới (vd. keep_count=2 lưu từ trước) gửi lại vẫn là
    // no-op chứ không phải 400.
    if (SUPERADMIN_ONLY_KEYS.has(key)) {
      const rawStr = String(raw ?? '')
      if (key === 'backup_drive_service_account' && rawStr === '********') {
        // dấu che = giữ nguyên (xử lý bên dưới)
      } else if (effectiveSubmitted(key, rawStr) === effectiveStored(key, existingMap.get(key))) {
        continue
      } else if (!isSuperAdmin) {
        requireSuperAdmin(adminUser)
      }
    }

    let value: string
    try {
      if (key === 'backup_auto_enabled' || key === 'backup_drive_enabled') {
        value = validateBoolean(key, String(raw))
      } else if (key === 'backup_auto_hour') {
        value = validateInt(key, String(raw), 0, 23)
      } else if (key === 'backup_keep_count') {
        // Tối thiểu 1 — chỉ SuperAdmin tới được đây khi giá trị đổi (xem trên), nên
        // trần dưới "≥ 3 cho người không phải SuperAdmin" mạnh hơn cả: họ không đổi
        // được con số này. Xoay vòng còn tự giữ bản mới nhất của mỗi loại.
        value = validateInt(key, String(raw), 1, 365)
      } else if (key === 'backup_auto_days') {
        value = validateDays(String(raw))
      } else if (key === 'backup_drive_service_account') {
        // `********` = giữ nguyên giá trị cũ; rỗng = xoá (lưu chuỗi rỗng).
        const rawStr = String(raw)
        if (rawStr === '********') continue
        value = rawStr.trim()
      } else {
        value = String(raw).trim()
      }
    } catch (err: unknown) {
      // Trước đây các hàm validate ném `Error` trần → 500, trái với "sai trả 400".
      throw createError({ statusCode: 400, statusMessage: err instanceof Error ? err.message : `${key} không hợp lệ` })
    }
    // Khoá JSON của service account là BÍ MẬT: dòng audit chỉ ghi "đã có/chưa có",
    // không bao giờ chép nguyên văn khoá cũ vào `activity_logs`.
    oldValues[key] = key === 'backup_drive_service_account'
      ? (existingMap.get(key) ? '[đã cấu hình]' : null)
      : existingMap.get(key) ?? null
    entries.push({ key, value })
  }

  if (entries.length === 0) {
    return { ok: true, message: 'Không có gì để cập nhật.' }
  }

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      await tx.insert(settings).values({ key: entry.key, value: entry.value, group: 'backup' })
        .onDuplicateKeyUpdate({ set: { value: entry.value } })
    }
    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      resourceId: null,
      meta: { settingsGroup: 'backup', updated: entries.map(e => e.key), oldValues },
    })
  })

  return { ok: true }
})

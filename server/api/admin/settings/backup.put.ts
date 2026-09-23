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
import { requireResourcePermission } from '../../../utils/permissions'

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

  for (const [key, raw] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) continue // bỏ qua key lạ
    let value: string
    if (key === 'backup_auto_enabled' || key === 'backup_drive_enabled') {
      value = validateBoolean(key, String(raw))
    } else if (key === 'backup_auto_hour') {
      value = validateInt(key, String(raw), 0, 23)
    } else if (key === 'backup_keep_count') {
      value = validateInt(key, String(raw), 1, 365)
    } else if (key === 'backup_auto_days') {
      value = validateDays(String(raw))
    } else if (key === 'backup_drive_service_account') {
      // `********` = giữ nguyên giá trị cũ; rỗng = xoá (lưu chuỗi rỗng).
      const rawStr = String(raw)
      if (rawStr === '********') {
        const old = existingMap.get(key)
        if (old) oldValues[key] = old // ghi nhận để audit nhưng không update
        continue
      }
      value = rawStr.trim()
    } else {
      value = String(raw).trim()
    }
    oldValues[key] = existingMap.get(key) ?? null
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

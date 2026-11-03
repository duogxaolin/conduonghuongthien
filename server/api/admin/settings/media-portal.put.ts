/**
 * PUT /api/admin/settings/media-portal
 *
 * Lưu 9 khoá cấu hình Media Portal vào bảng `settings` (group `media_portal`).
 *
 * Validate từng giá trị bằng `parseMediaBoolean`/`parseMediaInteger` + bounds từ
 * `MEDIA_BOUNDS` — sai trả 400 kèm lý do, KHÔNG lùi về mặc định (cùng quy tắc
 * `resolveMediaConfig`: giá trị hỏng đọc thành `false` sẽ tắt tính năng trong
 * khi người vận hành tin là đã bật).
 *
 * Ghi audit `update media_portal_settings` kèm giá trị trước/sau trong `meta`,
 * trong cùng transaction với lượt ghi `settings` — theo `tests/reader-audit-atomicity.test.ts`:
 * `tx.insert(activityLogs)`, không `db.insert(activityLogs)` trong khối.
 *
 * `workdir` và FFmpeg cố ý không cho sửa ở đây — đổi workdir cần restart volume
 * mount, đổi qua CSDL mà không restart = config đang chạy không khớp CSDL.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { inArray } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'
import { videoR2RetargetViolation } from '../../../utils/settings-credential-guard'
import { getDb } from '../../../utils/db'
import { settings, activityLogs } from '../../../db/schema'
import {
  parseMediaBoolean,
  parseMediaInteger,
  MEDIA_BOUNDS,
} from '../../../utils/media-config'
import { encryptVideoR2Secret } from '../../../utils/media-r2-secret'
import { MASKED_SECRET, isRetypedVideoSecret } from '../../../../shared/settings-credential-rules'

type FieldSpec = {
  dbKey: string
  label: string
  validate: (raw: string) => string
}

/**
 * Validate provider R2 — chỉ nhận 'local' hoặc 'r2'. Giá trị lạ trả 400, không
 * lùi về 'local' (che giấu quyết định của cán bộ).
 */
function validateVideoStorageProvider(raw: string): string {
  const text = raw.trim().toLowerCase()
  if (text !== 'local' && text !== 'r2') {
    throw new Error('provider phải là "local" hoặc "r2"')
  }
  return text
}

/**
 * Validate R2 string field (account ID, access key, bucket, public URL) — chỉ
 * trim + giới hạn chiều dài, không parse số. Rỗng hợp lệ (chưa cấu hình).
 */
function validateR2String(label: string, raw: string, maxLen: number): string {
  const text = raw.trim()
  if (text.length > maxLen) {
    throw new Error(`${label} không được quá ${maxLen} ký tự`)
  }
  return text
}

/**
 * Validate + mã hoá R2 secret key. Rỗng **hoặc dấu che** (`********`, thứ GET trả
 * cho bí mật đã lưu) = giữ nguyên (không xoá, không lưu chuỗi dấu che đè lên bí
 * mật thật) — xử lý ở niveau caller: nếu `validated` rỗng thì skip update. Có giá
 * trị → mã hoá AES-256-GCM bằng `CHATBOT_ENCRYPTION_SECRET` (nhãn
 * `cdkt-video-r2-secret:v1`), lưu dạng JSON envelope.
 */
function validateAndEncryptR2Secret(raw: string): string {
  if (!isRetypedVideoSecret(raw)) return ''
  const text = raw.trim()
  if (text.length > 256) {
    throw new Error('R2 secret key không được quá 256 ký tự')
  }
  const envelope = encryptVideoR2Secret(text)
  return JSON.stringify(envelope)
}

const FIELD_SPECS: Record<string, FieldSpec> = {
  uploadEnabled: {
    dbKey: 'media_upload_enabled',
    label: 'Nhận video',
    validate: (raw) => String(parseMediaBoolean('media_upload_enabled', raw, false)),
  },
  maxUploadSize: {
    dbKey: 'media_upload_max_size',
    label: 'Dung lượng tải lên tối đa',
    validate: (raw) => String(parseMediaInteger(
      'media_upload_max_size', raw, 0,
      MEDIA_BOUNDS.maxUploadSize.min, MEDIA_BOUNDS.maxUploadSize.max,
    )),
  },
  chunkSize: {
    dbKey: 'media_upload_chunk_size',
    label: 'Kích thước chunk',
    validate: (raw) => String(parseMediaInteger(
      'media_upload_chunk_size', raw, 0,
      MEDIA_BOUNDS.chunkSize.min, MEDIA_BOUNDS.chunkSize.max,
    )),
  },
  diskFloorBytes: {
    dbKey: 'media_disk_floor_bytes',
    label: 'Ngưỡng đĩa tối thiểu',
    validate: (raw) => String(parseMediaInteger(
      'media_disk_floor_bytes', raw, 0,
      MEDIA_BOUNDS.diskFloorBytes.min, MEDIA_BOUNDS.diskFloorBytes.max,
    )),
  },
  sessionInactivityHours: {
    dbKey: 'media_session_inactivity_hours',
    label: 'Thời gian dọn upload bỏ dở',
    validate: (raw) => String(parseMediaInteger(
      'media_session_inactivity_hours', raw, 0,
      MEDIA_BOUNDS.sessionInactivityHours.min, MEDIA_BOUNDS.sessionInactivityHours.max,
    )),
  },
  processingHeartbeatSeconds: {
    dbKey: 'media_processing_heartbeat_seconds',
    label: 'Nhịp tim xử lý',
    validate: (raw) => String(parseMediaInteger(
      'media_processing_heartbeat_seconds', raw, 0,
      MEDIA_BOUNDS.processingHeartbeatSeconds.min, MEDIA_BOUNDS.processingHeartbeatSeconds.max,
    )),
  },
  processingStaleMinutes: {
    dbKey: 'media_processing_stale_minutes',
    label: 'Tuổi stale',
    validate: (raw) => String(parseMediaInteger(
      'media_processing_stale_minutes', raw, 0,
      MEDIA_BOUNDS.processingStaleMinutes.min, MEDIA_BOUNDS.processingStaleMinutes.max,
    )),
  },
  processingMaxJobs: {
    dbKey: 'media_processing_max_jobs',
    label: 'Job xử lý tối đa',
    validate: (raw) => String(parseMediaInteger('media_processing_max_jobs', raw, 0, 1, 4)),
  },
  processingMaxAttempts: {
    dbKey: 'media_processing_max_attempts',
    label: 'Thử lại tối đa',
    validate: (raw) => String(parseMediaInteger('media_processing_max_attempts', raw, 0, 1, 10)),
  },
  // ── R2 riêng cho video (6 khoá) ──
  videoStorageProvider: {
    dbKey: 'media_video_storage_provider',
    label: 'Lưu trữ video',
    validate: validateVideoStorageProvider,
  },
  videoR2AccountId: {
    dbKey: 'media_video_r2_account_id',
    label: 'R2 Account ID',
    validate: (raw) => validateR2String('R2 Account ID', raw, 128),
  },
  videoR2AccessKey: {
    dbKey: 'media_video_r2_access_key',
    label: 'R2 Access Key',
    validate: (raw) => validateR2String('R2 Access Key', raw, 128),
  },
  videoR2SecretKey: {
    dbKey: 'media_video_r2_secret_key',
    label: 'R2 Secret Key',
    validate: validateAndEncryptR2Secret,
  },
  videoR2Bucket: {
    dbKey: 'media_video_r2_bucket',
    label: 'R2 Bucket',
    validate: (raw) => validateR2String('R2 Bucket', raw, 128),
  },
  videoR2PublicUrl: {
    dbKey: 'media_video_r2_public_url',
    label: 'R2 Public URL',
    validate: (raw) => validateR2String('R2 Public URL', raw, 512),
  },
}

const ACCEPTED_FIELDS = new Set(Object.keys(FIELD_SPECS))
const FIELD_DB_KEYS = Object.values(FIELD_SPECS).map(spec => spec.dbKey)

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu cài đặt không hợp lệ.' })
  }

  const incoming = body.fields
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu trường `fields`.' })
  }

  // Chấp nhận đúng các field đã biết; reject field lạ thay vì lặng lẽ bỏ qua.
  const normalized: Array<{ field: string, dbKey: string, value: string }> = []
  for (const [field, raw] of Object.entries(incoming)) {
    if (!ACCEPTED_FIELDS.has(field)) {
      throw createError({ statusCode: 400, statusMessage: `Trường không hợp lệ: ${field}` })
    }
    const spec = FIELD_SPECS[field]!
    const strRaw = raw === null || raw === undefined ? '' : String(raw)
    let validated: string
    try {
      validated = spec.validate(strRaw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Giá trị không hợp lệ'
      throw createError({ statusCode: 400, statusMessage: `${spec.label}: ${msg}` })
    }
    normalized.push({ field, dbKey: spec.dbKey, value: validated })
  }

  // R2 secret key rỗng = giữ nguyên (không xoá) — cán bộ chỉ muốn đổi bucket,
  // không nhập lại secret. Nhớ dbKey để skip hoàn toàn, không ghi đè rỗng.
  const R2_SECRET_DB_KEY_LOCAL = 'media_video_r2_secret_key'

  const db = getDb()

  // Giá trị hiện tại cho audit (trước/sau) và cho quy tắc đổi đích R2 bên dưới.
  // Đọc theo KHOÁ, không theo `group`: một hàng R2 video từng được ghi với nhóm
  // khác (seed cũ, sửa tay) vẫn là giá trị đang chạy — lọc theo nhóm sẽ thấy "chưa
  // có bí mật" và để lọt lượt đổi account id không kèm bí mật.
  const currentRows = await db.select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, FIELD_DB_KEYS))
  const current = new Map(currentRows.map(row => [row.key, row.value ?? '']))

  // Đổi Account ID / Bucket của R2 video mà không gõ lại Secret Key → 400, trước
  // mọi ghi. Cùng quy tắc với SMTP / R2 ảnh ở `settings/index.put.ts`: bí mật đã
  // lưu không được ghép với một đích mới mà người lưu không chứng minh là biết bí
  // mật đó. Xem `shared/settings-credential-rules.ts`.
  const retargetViolation = videoR2RetargetViolation(incoming as Record<string, unknown>, {
    accountId: current.get('media_video_r2_account_id') ?? '',
    bucket: current.get('media_video_r2_bucket') ?? '',
    secretStored: (current.get(R2_SECRET_DB_KEY_LOCAL) ?? '') !== '',
  })
  if (retargetViolation) {
    throw createError({ statusCode: 400, statusMessage: retargetViolation })
  }

  /**
   * Giá trị audit cho secret key: `********` khi có, '' khi không — không lộ
   * envelope, và (spec admin-settings-secrets) cũng không lộ 4 ký tự cuối, vì
   * `activity_logs` được đọc lại qua `/admin/users/activity`. Dòng audit vẫn cho
   * biết bí mật đã đổi (khoá có mặt trong `changes`). Trường khác ghi giá trị thật.
   */
  function maskForAudit(dbKey: string, value: string): string {
    if (dbKey !== R2_SECRET_DB_KEY_LOCAL) return value
    return value ? MASKED_SECRET : ''
  }

  try {
    await db.transaction(async (tx) => {
      const changes: Array<{ key: string, from: string, to: string }> = []
      for (const entry of normalized) {
        // Secret key rỗng → skip, giữ nguyên giá trị cũ.
        if (entry.dbKey === R2_SECRET_DB_KEY_LOCAL && !entry.value) continue
        const before = current.get(entry.dbKey) ?? ''
        if (before === entry.value) continue
        await tx.insert(settings).values({ key: entry.dbKey, value: entry.value, group: 'media_portal' })
          .onDuplicateKeyUpdate({ set: { value: entry.value } })
        changes.push({
          key: entry.dbKey,
          from: maskForAudit(entry.dbKey, before),
          to:   maskForAudit(entry.dbKey, entry.value),
        })
      }

      if (changes.length > 0) {
        await tx.insert(activityLogs).values({
          userId: adminUser.id ?? null,
          action: 'update media_portal_settings',
          resource: 'settings',
          resourceId: null,
          meta: { changes },
        })
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Không lưu được cài đặt.'
    throw createError({ statusCode: 500, statusMessage: msg })
  }

  return { ok: true }
})

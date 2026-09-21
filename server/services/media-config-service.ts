/**
 * Đọc cấu hình Media Portal với lớp override: CSDL > biến môi trường > mặc định.
 *
 * `resolveMediaConfig()` (server/utils/media-config.ts) chỉ đọc `process.env`.
 * Trang `/admin/settings/media-portal` cho cán bộ sửa qua CSDL, nên cần một hàm
 * ghép môi trường với hàng `settings` (group `media_portal`). Quy tắc:
 *
 *   • CSDL có hàng mang giá trị khác rỗng → dùng CSDL.
 *   • CSDL rỗng/không có → dùng biến môi trường (qua `resolveMediaConfig`).
 *   • Cả hai rỗng → mặc định (xử lý sẵn trong `resolveMediaConfig`).
 *
 * Tách ra file riêng để cả endpoint GET/PUT settings và các endpoint media gọi
 * chung. Trả thêm `sources` để trang hiển thị từng field đến từ đâu — cùng
 * pattern `data-retention` (`daysSource`, `maxRowsSource`).
 */
import { eq } from 'drizzle-orm'
import { settings } from '../db/schema'
import type { Database } from '../utils/db'
import {
  resolveMediaConfig,
  parseMediaBoolean,
  parseMediaInteger,
  MEDIA_BOUNDS,
  type MediaConfig,
} from '../utils/media-config'
import {
  decryptVideoR2Secret,
  type EncryptedVideoR2Secret,
} from '../utils/media-r2-secret'

/**
 * Chín khoá CSDL thuộc nhóm `media_portal`. Từng khoá map tới một field của
 * `MediaConfig`. Đặt ở đây (không ở media-config.ts) vì đây là ranh giới CSDL,
 * còn media-config.ts chủ ý chỉ import `node:*` để kiểm được ngoài trình duyệt.
 */
export const MEDIA_PORTAL_SETTING_KEYS = [
  'media_upload_enabled',
  'media_upload_max_size',
  'media_upload_chunk_size',
  'media_disk_floor_bytes',
  'media_session_inactivity_hours',
  'media_processing_heartbeat_seconds',
  'media_processing_stale_minutes',
  'media_processing_max_jobs',
  'media_processing_max_attempts',
  // R2 riêng cho video — 6 khoá. Tách khỏi group `media` (thư viện ảnh) vì
  // đây là bucket + credential riêng cho Media Portal. Secret key mã hoá
  // AES-256-GCM bằng `CHATBOT_ENCRYPTION_SECRET` (nhãn `cdkt-video-r2-secret:v1`).
  'media_video_storage_provider',
  'media_video_r2_account_id',
  'media_video_r2_access_key',
  'media_video_r2_secret_key',
  'media_video_r2_bucket',
  'media_video_r2_public_url',
] as const

export type MediaPortalSource = 'database' | 'environment' | 'default'

export type VideoStorageSources = {
  provider: MediaPortalSource
  r2AccountId: MediaPortalSource
  r2AccessKey: MediaPortalSource
  r2SecretKey: MediaPortalSource
  r2Bucket: MediaPortalSource
  r2PublicUrl: MediaPortalSource
}

export type MediaConfigWithSources = {
  config: MediaConfig
  sources: Record<keyof typeof FIELD_MAP, MediaPortalSource>
  videoStorageSources: VideoStorageSources
  /** Secret envelope giải mã fail (khóa xoay / CSDL copy sai). False khi chưa cấu hình. */
  videoStorageSecretUnreadable: boolean
  /** 4 ký tự cuối của plaintext secret (cho masking `••••1234`). Null khi chưa cấu hình. */
  videoStorageSecretLastFour: string | null
}

/**
 * Map field → (dbKey, parser, bounds). Dùng ở đây để đọc, và ở PUT endpoint để
 * validate — một bản duy nhất, tránh hai chỗ mô tả cùng một ranh giới.
 */
const FIELD_MAP = {
  uploadEnabled: {
    dbKey: 'media_upload_enabled',
    parse: (v: string) => parseMediaBoolean('media_upload_enabled', v, false),
  },
  maxUploadSize: {
    dbKey: 'media_upload_max_size',
    parse: (v: string) => parseMediaInteger(
      'media_upload_max_size', v, 0,
      MEDIA_BOUNDS.maxUploadSize.min, MEDIA_BOUNDS.maxUploadSize.max,
    ),
  },
  chunkSize: {
    dbKey: 'media_upload_chunk_size',
    parse: (v: string) => parseMediaInteger(
      'media_upload_chunk_size', v, 0,
      MEDIA_BOUNDS.chunkSize.min, MEDIA_BOUNDS.chunkSize.max,
    ),
  },
  diskFloorBytes: {
    dbKey: 'media_disk_floor_bytes',
    parse: (v: string) => parseMediaInteger(
      'media_disk_floor_bytes', v, 0,
      MEDIA_BOUNDS.diskFloorBytes.min, MEDIA_BOUNDS.diskFloorBytes.max,
    ),
  },
  sessionInactivityHours: {
    dbKey: 'media_session_inactivity_hours',
    parse: (v: string) => parseMediaInteger(
      'media_session_inactivity_hours', v, 0,
      MEDIA_BOUNDS.sessionInactivityHours.min, MEDIA_BOUNDS.sessionInactivityHours.max,
    ),
  },
  processingHeartbeatSeconds: {
    dbKey: 'media_processing_heartbeat_seconds',
    parse: (v: string) => parseMediaInteger(
      'media_processing_heartbeat_seconds', v, 0,
      MEDIA_BOUNDS.processingHeartbeatSeconds.min, MEDIA_BOUNDS.processingHeartbeatSeconds.max,
    ),
  },
  processingStaleMinutes: {
    dbKey: 'media_processing_stale_minutes',
    parse: (v: string) => parseMediaInteger(
      'media_processing_stale_minutes', v, 0,
      MEDIA_BOUNDS.processingStaleMinutes.min, MEDIA_BOUNDS.processingStaleMinutes.max,
    ),
  },
  processingMaxJobs: {
    dbKey: 'media_processing_max_jobs',
    parse: (v: string) => parseMediaInteger(
      'media_processing_max_jobs', v, 0, 1, 4,
    ),
  },
  processingMaxAttempts: {
    dbKey: 'media_processing_max_attempts',
    parse: (v: string) => parseMediaInteger(
      'media_processing_max_attempts', v, 0, 1, 10,
    ),
  },
} as const

type FieldName = keyof typeof FIELD_MAP

/**
 * Đọc **tất cả** khoá thuộc group `media_portal` từ bảng `settings` (9 khoá
 * scalar + 6 khoá R2). Trả map dbKey → giá trị chuỗi (chưa parse), chỉ giữ hàng
 * khác rỗng. Hàng rỗng = không override.
 */
async function readAllDbSettings(db: Database): Promise<Record<string, string>> {
  const rows = await db.select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.group, 'media_portal'))
  const map: Record<string, string> = {}
  for (const row of rows) {
    if (row.value != null && row.value.trim() !== '') map[row.key] = row.value
  }
  return map
}

/**
 * Đọc 9 khoá scalar từ bảng settings. Trả map field → giá trị chuỗi.
 */
async function readDbOverrides(db: Database): Promise<Partial<Record<FieldName, string>>> {
  const map = await readAllDbSettings(db)
  const out: Partial<Record<FieldName, string>> = {}
  for (const [field, spec] of Object.entries(FIELD_MAP) as Array<[FieldName, typeof FIELD_MAP[FieldName]]>) {
    if (spec.dbKey in map) out[field] = map[spec.dbKey]
  }
  return out
}

/** Key của R2 secret trong bảng settings → có thể vắng (chưa cấu hình). */
const R2_SECRET_DB_KEY = 'media_video_r2_secret_key'

/**
 * Đọc 6 khoá R2 từ bảng settings + giải mã secret key. Trả:
 *   • `provider` — 'r2' | 'local' (mặc định 'local' nếu không cấu hình).
 *   • `r2` — config R2 đầy đủ khi provider='r2' và đủ credential, hoặc `undefined`.
 *   • `sources` — nguồn từng khoá.
 *   • `secretUnreadable` — true khi secret envelope có nhưng giải mã fail (khóa
 *     xoay hoặc CSDL copy-paste sai). Trang settings hiện đúng triệu chứng thay
 *     vì lẫn vào "chưa cấu hình" — cùng pattern `secret_unreadable` Google OAuth.
 *
 * Secret key lưu dạng JSON envelope (`EncryptedVideoR2Secret`). Giải mã bằng
 * `CHATBOT_ENCRYPTION_SECRET` qua nhãn `cdkt-video-r2-secret:v1`.
 */
async function readR2Config(
  db: Database,
): Promise<{
  videoStorage: MediaConfig['videoStorage']
  sources: VideoStorageSources
  secretUnreadable: boolean
  secretLastFour: string | null
}> {
  const map = await readAllDbSettings(db)

  const providerRaw = map['media_video_storage_provider'] ?? ''
  const provider: 'local' | 'r2' = providerRaw === 'r2' ? 'r2' : 'local'
  const providerSource: MediaPortalSource = providerRaw ? 'database' : 'default'

  const accountId = map['media_video_r2_account_id'] ?? ''
  const accessKey = map['media_video_r2_access_key'] ?? ''
  const bucket = map['media_video_r2_bucket'] ?? ''
  const publicUrl = map['media_video_r2_public_url'] ?? ''
  const secretRaw = map[R2_SECRET_DB_KEY] ?? ''

  const sources: VideoStorageSources = {
    provider: providerSource,
    r2AccountId: accountId ? 'database' : 'default',
    r2AccessKey: accessKey ? 'database' : 'default',
    r2SecretKey: secretRaw ? 'database' : 'default',
    r2Bucket: bucket ? 'database' : 'default',
    r2PublicUrl: publicUrl ? 'database' : 'default',
  }

  // provider=local → không cần R2 config, trả thẳng.
  if (provider === 'local') {
    return {
      videoStorage: { provider: 'local' },
      sources,
      secretUnreadable: false,
      secretLastFour: null,
    }
  }

  // provider='r2' nhưng thiếu credential → vẫn trả provider='r2' (can bộ vừa
  // bật nhưng chưa nhập key) và để PUT endpoint / trang settings cảnh báo. Không
  // lùi silent về 'local' vì đó che giấu quyết định của cán bộ.
  if (!accountId || !accessKey || !bucket) {
    return {
      videoStorage: { provider: 'r2' },
      sources,
      secretUnreadable: false,
      secretLastFour: null,
    }
  }

  // Giải mã secret key.Envelope có thể vắng (chưa nhập) hoặc hỏng (khóa xoay).
  let secretAccessKey = ''
  let secretUnreadable = false
  let secretLastFour: string | null = null
  if (secretRaw) {
    try {
      const envelope = JSON.parse(secretRaw) as EncryptedVideoR2Secret
      secretAccessKey = decryptVideoR2Secret(envelope)
      secretLastFour = envelope.lastFour ?? secretAccessKey.slice(-4)
    } catch {
      // Khóa không khớp / envelope hỏng / CSDL copy sai. Đánh dấu để trang hiện
      // triệu chứng, không ném — service gọi phải lùi an toàn chứ không sập.
      secretUnreadable = true
    }
  }

  if (secretUnreadable || !secretAccessKey) {
    // provider='r2' nhưng secret không dùng được — trả provider='r2' kèm cờ,
    // không build r2 client. Upload mới sẽ lùi local (xem video-processing.ts).
    return {
      videoStorage: { provider: 'r2' },
      sources,
      secretUnreadable,
      secretLastFour,
    }
  }

  return {
    videoStorage: {
      provider: 'r2',
      r2: {
        accountId,
        accessKeyId: accessKey,
        secretAccessKey,
        bucket,
        publicUrl,
      },
    },
    sources,
    secretUnreadable,
    secretLastFour,
  }
}

/**
 * Đọc config với override CSDL. Trả `{ config, sources }`.
 *
 * Nguồn từng field:
 *   • `database` — CSDL có hàng khác rỗng, đã đè.
 *   • `environment` — CSDL rỗng nhưng env có giá trị (parse thành giá trị khác
 *     mặc định). Không phân biệt được "env đặt đúng bằng default" với "env
 *     trống" — cả hai đều `default`. Đó là giới hạn chấp nhận được: trang hiển
 *     thị "mặc định" khi env trống hoặc env trùng default.
 *   • `default` — cả CSDL lẫn env đều rỗng.
 */
export async function resolveMediaConfigWithDb(db: Database): Promise<MediaConfigWithSources> {
  const envConfig = resolveMediaConfig()
  const dbOverrides = await readDbOverrides(db)
  const config: MediaConfig = { ...envConfig }
  const sources = {} as Record<FieldName, MediaPortalSource>

  for (const [field, spec] of Object.entries(FIELD_MAP) as Array<[FieldName, typeof FIELD_MAP[FieldName]]>) {
    const dbVal = dbOverrides[field]
    if (dbVal !== undefined) {
      // Đè bằng CSDL. parseMediaBoolean/Integer ném khi sai — nhưng đây là giá
      // trị đã qua PUT endpoint (đã validate), nên ta bắt và lùi về env nếu lạ.
      try {
        ;(config as Record<FieldName, unknown>)[field] = spec.parse(dbVal)
        sources[field] = 'database'
        continue
      } catch {
        // Giá trị CSDL hỏng (ai đó sửa tay) → lùi về env/default.
      }
    }
    sources[field] = 'default'
  }

  // R2 config — object lồng, đi qua `readR2Config` riêng (giải mã secret).
  const r2 = await readR2Config(db)
  config.videoStorage = r2.videoStorage

  return {
    config,
    sources,
    videoStorageSources: r2.sources,
    videoStorageSecretUnreadable: r2.secretUnreadable,
    videoStorageSecretLastFour: r2.secretLastFour,
  }
}

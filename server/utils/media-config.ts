/**
 * Cấu hình cho Media Portal — cổng tải lên và xử lý video.
 *
 * Tách khỏi nơi dùng vì **nhiều tệp cần cùng một con số**, và mỗi con số ở đây
 * đều là một quyết định vận hành chứ không phải một hằng số kỹ thuật:
 *
 *   • `uploadEnabled` — công tắc quyết định máy chủ này có nhận video hay không.
 *     Đây là công tắc **duy nhất** cho cả hai đầu: giao diện ẩn nút, và
 *     `initUpload` từ chối request. Một công tắc chỉ ẩn nút là một công tắc trang
 *     trí — cùng lớp lỗi với `MEDIA_UPLOAD_ENABLED` trong `manage.sh` không được
 *     đọc ở đâu.
 *   • `maxUploadSize` — trần dung lượng một lượt tải. Vượt trần này thì máy chủ
 *     1–2 GB hết đĩa **giữa** lượt ghi, và thứ hỏng không phải lượt tải đó mà là
 *     cơ sở dữ liệu.
 *   • `chunkSize` — kích thước một phần. Nhỏ quá thì mỗi video 10 GB là 20 000
 *     request; lớn quá thì một phần nằm trọn trong RAM của tiến trình.
 *   • `sessionInactivityHours` — mốc dọn lượt tải bỏ dở. Đây là dữ liệu **của
 *     cán bộ đang dở việc**, nên dọn sớm là xoá công việc của người ta, còn dọn
 *     muộn là giữ rác. 24 giờ: một lượt tải 10 GB qua đường truyền chậm có thể
 *     mất vài giờ, và không ai quay lại sau một ngày.
 *   • `diskFloorBytes` — ngưỡng dừng xử lý. Đây không phải "cảnh báo sắp đầy":
 *     đây là mức mà dưới nó việc ghi tiếp **sẽ** hỏng, và hỏng giữa chừng thì
 *     hàng `media_items` đã tạo rồi mà tệp thì không.
 *   • `processingStaleMinutes` — tuổi của một nhịp tim trước khi coi là chết.
 *     Phải lớn hơn `processingHeartbeatSeconds` một khoảng đủ rộng để một nhịp
 *     trượt không bị đọc thành "tiến trình đã chết".
 *
 * Cùng khuôn `data-retention-config.ts` / `analytics-config.ts`: giá trị sai bị
 * **từ chối** chứ không lặng lẽ lùi về mặc định. Một `MEDIA_UPLOAD_MAX_SIZE=10GB`
 * (có hậu tố, `Number()` ra `NaN`) lùi về mặc định sẽ là một máy chủ nhận 10 GB
 * trong khi người vận hành tin là 10 MB.
 */

/** Mặc định chọn cho VPS 1–2 GB mà dự án nhắm tới. */
export const MEDIA_DEFAULTS = {
  /** 10 MB: một phần nằm gọn trong RAM của tiến trình, và 10 GB là 1000 request. */
  chunkSize: 10 * 1024 * 1024,
  /** 10 GB. */
  maxUploadSize: 10 * 1024 * 1024 * 1024,
  /** Một lượt tải bỏ dở quá 24 giờ thì dọn. */
  sessionInactivityHours: 24,
  /** 1 GB. Dưới mức này việc ghi tiếp sẽ hỏng, không chỉ là "sắp đầy". */
  diskFloorBytes: 1024 * 1024 * 1024,
  /** Nhịp tim 5 phút, tuổi cho phép 10 phút — gấp đôi, để một nhịp trượt không thành án tử. */
  processingHeartbeatSeconds: 5 * 60,
  processingStaleMinutes: 10,
} as const

export const MEDIA_BOUNDS = {
  /** 1 MB … 100 MB. */
  chunkSize: { min: 1024 * 1024, max: 100 * 1024 * 1024 },
  /** 1 MB … 100 GB. */
  maxUploadSize: { min: 1024 * 1024, max: 100 * 1024 * 1024 * 1024 },
  sessionInactivityHours: { min: 1, max: 24 * 30 },
  /** 0 = tắt hẳn phép kiểm đĩa (chỉ dùng khi volume nằm trên hệ thống tệp lạ). */
  diskFloorBytes: { min: 0, max: 1024 * 1024 * 1024 * 1024 },
  processingHeartbeatSeconds: { min: 30, max: 3600 },
  processingStaleMinutes: { min: 1, max: 24 * 60 },
} as const

export type MediaConfig = {
  uploadEnabled: boolean
  maxUploadSize: number
  chunkSize: number
  sessionInactivityHours: number
  diskFloorBytes: number
  processingHeartbeatSeconds: number
  processingStaleMinutes: number
  processingMaxJobs?: number
  processingMaxAttempts?: number
  /** Thư mục làm việc tuyệt đối: chứa `uploads/` và `media/`. */
  workdir: string
  /**
   * Lưu trữ cho video đã chuyển mã. Tách khỏi R2 của thư viện ảnh (group
   * `media`) — bucket riêng, credential riêng, nhãn mã hoá riêng
   * (`cdkt-video-r2-secret:v1`). `provider='local'` = giữ trên đĩa như cũ;
   * `provider='r2'` = sync cây rendition lên R2 sau transcode và xoá bản local.
   * `r2` có thể vắng khi provider=local hoặc khi chưa cấu hình.
   */
  videoStorage: {
    provider: 'local' | 'r2'
    r2?: {
      accountId: string
      accessKeyId: string
      secretAccessKey: string
      bucket: string
      publicUrl: string
    }
  }
}

/**
 * Một giá trị boolean từ biến môi trường, **từ chối** giá trị lạ.
 *
 * `'1'`/`'true'` là bật, `'0'`/`'false'` là tắt, chuỗi rỗng là mặc định. Bất cứ
 * thứ gì khác ném ra: `MEDIA_UPLOAD_ENABLED=yes` đọc thành `false` sẽ tắt tính
 * năng trong khi người vận hành tin là đã bật, và triệu chứng là "nút tải lên
 * biến mất" — không có gì chỉ vào biến môi trường.
 */
export function parseMediaBoolean(name: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'on', 'yes'].includes(text)) return true
  if (['0', 'false', 'off', 'no'].includes(text)) return false
  throw new Error(`${name} must be one of: 1, 0, true, false, on, off, yes, no`)
}

/** Số nguyên trong khoảng, có thể nhận `0` khi `min` cho phép. Sai thì ném. */
export function parseMediaInteger(name: string, value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

/**
 * Mặc định của thư mục làm việc: `<cwd>/.data/media`.
 *
 * `.data` đã nằm trong `.gitignore` từ trước, nên một lượt chạy thử ở máy dev
 * không để lại video trong cây mã nguồn. Production khai `CDKT_MEDIA_WORKDIR`
 * trỏ vào volume (`docker-compose.yml`, tác vụ 15.2).
 */
export function defaultMediaWorkdir(): string {
  return `${process.cwd()}/.data/media`
}

/**
 * Đọc cấu hình từ môi trường. Gọi **lúc dùng**, không lúc import: một module
 * ném ra khi import sẽ làm đỏ cả bộ test vì một biến môi trường của máy khác.
 */
export function resolveMediaConfig(env: Record<string, unknown> = process.env): MediaConfig {
  const workdir = String(env.CDKT_MEDIA_WORKDIR ?? '').trim() || defaultMediaWorkdir()
  return {
    // Mặc định TẮT. Một máy chủ chưa cài FFmpeg hoặc dưới trần RAM mà nhận video
    // sẽ nhận rồi không xử lý được — hàng `media_items` nằm ở `pending` vĩnh viễn.
    uploadEnabled: parseMediaBoolean('MEDIA_UPLOAD_ENABLED', env.MEDIA_UPLOAD_ENABLED, false),
    maxUploadSize: parseMediaInteger(
      'MEDIA_UPLOAD_MAX_SIZE', env.MEDIA_UPLOAD_MAX_SIZE,
      MEDIA_DEFAULTS.maxUploadSize, MEDIA_BOUNDS.maxUploadSize.min, MEDIA_BOUNDS.maxUploadSize.max,
    ),
    chunkSize: parseMediaInteger(
      'MEDIA_UPLOAD_CHUNK_SIZE', env.MEDIA_UPLOAD_CHUNK_SIZE,
      MEDIA_DEFAULTS.chunkSize, MEDIA_BOUNDS.chunkSize.min, MEDIA_BOUNDS.chunkSize.max,
    ),
    sessionInactivityHours: parseMediaInteger(
      'MEDIA_UPLOAD_SESSION_HOURS', env.MEDIA_UPLOAD_SESSION_HOURS,
      MEDIA_DEFAULTS.sessionInactivityHours, MEDIA_BOUNDS.sessionInactivityHours.min, MEDIA_BOUNDS.sessionInactivityHours.max,
    ),
    diskFloorBytes: parseMediaInteger(
      'MEDIA_DISK_FLOOR_BYTES', env.MEDIA_DISK_FLOOR_BYTES,
      MEDIA_DEFAULTS.diskFloorBytes, MEDIA_BOUNDS.diskFloorBytes.min, MEDIA_BOUNDS.diskFloorBytes.max,
    ),
    processingHeartbeatSeconds: parseMediaInteger(
      'MEDIA_PROCESSING_HEARTBEAT_SECONDS', env.MEDIA_PROCESSING_HEARTBEAT_SECONDS,
      MEDIA_DEFAULTS.processingHeartbeatSeconds, MEDIA_BOUNDS.processingHeartbeatSeconds.min, MEDIA_BOUNDS.processingHeartbeatSeconds.max,
    ),
    processingStaleMinutes: parseMediaInteger(
      'MEDIA_PROCESSING_STALE_MINUTES', env.MEDIA_PROCESSING_STALE_MINUTES,
      MEDIA_DEFAULTS.processingStaleMinutes, MEDIA_BOUNDS.processingStaleMinutes.min, MEDIA_BOUNDS.processingStaleMinutes.max,
    ),
    workdir,
    processingMaxJobs: parseMediaInteger('MEDIA_PROCESSING_MAX_JOBS', env.MEDIA_PROCESSING_MAX_JOBS, 1, 1, 4),
    processingMaxAttempts: parseMediaInteger('MEDIA_PROCESSING_MAX_ATTEMPTS', env.MEDIA_PROCESSING_MAX_ATTEMPTS, 3, 1, 10),
    // R2 cho video mặc định TẮT — tách biệt khỏi R2 của thư viện ảnh. Cấu hình
    // đi qua CSDL (settings group `media_portal`), không qua biến môi trường,
    // vì đây là credential nhập trong trang admin như Google OAuth.
    videoStorage: { provider: 'local' },
  }
}

/** Câu từ chối dùng chung cho mọi nhánh "máy chủ này không nhận video". */
export const UPLOAD_DISABLED_MESSAGE =
  'Tải lên video đã tắt trên máy chủ này. Liên hệ quản trị viên hệ thống để bật.'

/**
 * GET /api/admin/settings/media-portal
 *
 * Trả cấu hình Media Portal hiện tại (DB > env > default), nguồn từng field,
 * trạng thái FFmpeg, thư mục làm việc, và dung lượng đĩa trống.
 *
 * `workdir` và FFmpeg không sửa được qua form (cần restart container), nhưng
 * hiển thị để cán bộ biết hạ tầng đang thế nào — cùng pattern `favicon_url`
 * (hiển thị + nguồn, không cho sửa).
 */
import { createError, defineEventHandler } from 'h3'
import { statfs } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq, inArray, sql } from 'drizzle-orm'
import { checkPermission } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { mediaItems, settings } from '../../../db/schema'
import { resolveMediaConfigWithDb } from '../../../services/media-config-service'
import { defaultMediaWorkdir } from '../../../utils/media-config'
import { MASKED_SECRET } from '../../../../shared/settings-credential-rules'
import { execFileSync } from 'node:child_process'

function ffmpegPath(): string | null {
  try {
    return execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

async function diskFreeBytes(workdir: string): Promise<number | null> {
  try {
    const resolved = resolve(workdir)
    const stat = await statfs(resolved)
    // statfs trên Linux: bavail × bsize = bytes khả dụng cho user.
    return Number(stat.bavail) * Number(stat.bsize)
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  if (!actor || !checkPermission(actor.permissions ?? [], 'settings', 'read', actor.isSuperAdmin === true)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()
  const resolved = await resolveMediaConfigWithDb(db)
  const { config, sources } = resolved
  const ffmpeg = ffmpegPath()
  const diskFree = await diskFreeBytes(config.workdir)

  // Đếm số video theo storage_provider — video cũ = local, video mới (khi R2
  // bật) = r2. Chỉ đếm source='upload' (video thật), bỏ qua youtube (không lưu
  // trên R2/local — chỉ là link).
  const countRows = await db.select({
    provider: mediaItems.storageProvider,
    total: sql<number>`COUNT(*)`,
  })
    .from(mediaItems)
    .where(eq(mediaItems.source, 'upload'))
    .groupBy(mediaItems.storageProvider)
  let localCount = 0
  let r2Count = 0
  for (const row of countRows) {
    if (row.provider === 'r2') r2Count = Number(row.total)
    else localCount += Number(row.total)
  }

  // R2 config — không trả secret key, kể cả 4 ký tự cuối: `secretMasked` là
  // `********` (MASKED_SECRET) cho MỌI vai trò khi đã có bí mật (spec
  // admin-settings-secrets) — trước đây là `••••` + 4 ký tự cuối, tức một mẩu của
  // chính bí mật. `r2Configured` = đủ credential để dựng client (accountId +
  // accessKey + secret + bucket).
  const r2 = config.videoStorage.r2
  const r2Configured = !!(r2 && r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket)

  // Bốn trường công khai lấy THẲNG từ CSDL, không từ `config.videoStorage.r2`: object
  // đó chỉ có khi provider='r2' VÀ đủ bộ VÀ bí mật giải mã được. Trước đây, ngoài
  // trường hợp đó, trang nhận '' cho mọi ô rồi gửi '' ngược lên khi lưu bất kỳ cài
  // đặt nào — xoá sạch Account ID/Bucket đã lưu; nay lượt lưu đó còn bị chặn vì
  // "đổi Account ID/Bucket mà không nhập lại Secret Key". Trả đúng giá trị đang lưu
  // thì biểu mẫu khứ hồi không đổi gì. `secretStored` cho trang biết đã có bí mật
  // (kể cả khi không giải mã được) — cùng điều kiện máy chủ dùng để đòi nhập lại.
  const r2Rows = await db.select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [
      'media_video_r2_account_id', 'media_video_r2_access_key', 'media_video_r2_bucket',
      'media_video_r2_public_url', 'media_video_r2_secret_key',
    ]))
  const storedR2 = new Map(r2Rows.map(row => [row.key, row.value ?? '']))
  const secretStored = (storedR2.get('media_video_r2_secret_key') ?? '') !== ''
  // Có bí mật = lưu trong bảng (kể cả không giải mã được), hoặc cấu hình hiệu lực
  // có một bí mật đọc được (vd. từ biến môi trường).
  const secretConfigured = secretStored || Boolean(resolved.videoStorageSecretLastFour)
  // Không trả `r2` object (có secretAccessKey plaintext) — chỉ trả trường cần
  // thiết cho UI. Secret key KHÔNG bao giờ rời máy chủ dưới dạng plaintext.
  return {
    ok: true,
    config: {
      uploadEnabled: config.uploadEnabled,
      maxUploadSize: config.maxUploadSize,
      chunkSize: config.chunkSize,
      diskFloorBytes: config.diskFloorBytes,
      sessionInactivityHours: config.sessionInactivityHours,
      processingHeartbeatSeconds: config.processingHeartbeatSeconds,
      processingStaleMinutes: config.processingStaleMinutes,
      processingMaxJobs: config.processingMaxJobs,
      processingMaxAttempts: config.processingMaxAttempts,
      videoStorage: {
        provider: config.videoStorage.provider,
        r2AccountId: storedR2.get('media_video_r2_account_id') ?? '',
        r2AccessKey: storedR2.get('media_video_r2_access_key') ?? '',
        r2Bucket: storedR2.get('media_video_r2_bucket') ?? '',
        r2PublicUrl: storedR2.get('media_video_r2_public_url') ?? '',
      },
    },
    sources,
    videoStorageSources: resolved.videoStorageSources,
    videoStorage: {
      provider: config.videoStorage.provider,
      r2Configured,
      // `********` khi đã có bí mật, '' khi chưa — không bao giờ một phần bí mật.
      secretMasked: secretConfigured ? MASKED_SECRET : '',
      secretUnreadable: resolved.videoStorageSecretUnreadable,
      secretStored,
      localCount,
      r2Count,
    },
    // Read-only: không cho sửa qua form.
    workdir: config.workdir,
    workdirIsDefault: config.workdir === defaultMediaWorkdir(),
    ffmpegInstalled: ffmpeg !== null,
    ffmpegPath: ffmpeg,
    diskFreeBytes: diskFree,
    diskFloorBytes: config.diskFloorBytes,
  }
})

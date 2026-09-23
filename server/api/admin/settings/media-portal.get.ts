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
import { eq, sql } from 'drizzle-orm'
import { checkPermission } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { mediaItems } from '../../../db/schema'
import { resolveMediaConfigWithDb } from '../../../services/media-config-service'
import { defaultMediaWorkdir } from '../../../utils/media-config'
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

  // R2 config — không trả secret key plaintext. Chỉ trả `secretLastFour` để
  // trang hiển thị `••••1234` như Google OAuth. `r2Configured` = đủ credential
  // để dựng client (accountId + accessKey + secret + bucket).
  const r2 = config.videoStorage.r2
  const r2Configured = !!(r2 && r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket)
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
        r2AccountId: r2?.accountId ?? '',
        r2AccessKey: r2?.accessKeyId ?? '',
        r2Bucket: r2?.bucket ?? '',
        r2PublicUrl: r2?.publicUrl ?? '',
      },
    },
    sources,
    videoStorageSources: resolved.videoStorageSources,
    videoStorage: {
      provider: config.videoStorage.provider,
      r2Configured,
      // `••••` + 4 ký tự cuối — cùng masking Google OAuth. Null khi chưa nhập.
      secretMasked: resolved.videoStorageSecretLastFour
        ? `••••${resolved.videoStorageSecretLastFour}`
        : '',
      secretUnreadable: resolved.videoStorageSecretUnreadable,
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

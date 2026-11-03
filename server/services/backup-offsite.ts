/**
 * Bước "bản sao ngoài máy chủ" của một lượt sao lưu (wave2 D-OFFSITE): đưa các tệp
 * vừa đăng ký lên Google Drive khi đã cấu hình, và ghi `backups.offsite_status` cho
 * TỪNG tệp (`uploaded` / `failed` / `none` — xem `shared/backup-offsite-status.ts`).
 *
 * Tách khỏi `backup.ts` (đã quá 400 dòng) và giữ nguyên hành vi upload cũ:
 *   1. OAuth (ưu tiên nếu đã liên kết) — refresh token từ `backup_drive_oauth`, client
 *      id/secret RIÊNG cho Drive từ `backup_drive_oauth_config`;
 *   2. Service account (dự phòng) — khoá JSON trong settings, lưu dạng envelope (wave2
 *      2A) và đã giải mã ở `readBackupConfig`; không mở được → `failed` kèm lời nhắc
 *      dán lại khoá (`SERVICE_ACCOUNT_UNREADABLE_MESSAGE`), không phải `none`.
 * Ba module Drive vẫn nạp động: `googleapis` chỉ vào bộ nhớ khi thật sự upload.
 *
 * Bất biến:
 *  - Drive hỏng KHÔNG BAO GIỜ xoá tệp cục bộ và không biến lượt sao lưu đã đăng ký
 *    thành lượt hỏng — chỉ log `backup.drive_failed` + đánh dấu `failed`.
 *  - Trạng thái theo từng tệp: tệp 1 lên rồi, tệp 2 hỏng → tệp 1 `uploaded`, tệp 2 và
 *    mọi tệp sau `failed`.
 *  - Ghi trạng thái hỏng (CSDL chập chờn) chỉ log `backup.offsite_status_unwritten`.
 */
import path from 'node:path'
import { eq, inArray } from 'drizzle-orm'

import type { getDb } from '../utils/db'
import { backups } from '../db/schema'
import { logWarn } from '../utils/logger'
import { offsiteDestinationConfigured, type OffsiteStatus } from '../../shared/backup-offsite-status'

type Db = ReturnType<typeof getDb>

export interface OffsiteConfig {
  driveEnabled: boolean
  /** Khoá JSON service account ĐÃ GIẢI MÃ (`readBackupConfig`); rỗng = chưa có hoặc không mở được. */
  driveServiceAccount: string
  /**
   * Khoá service account đã lưu là envelope mà khoá mã hoá hiện tại không mở được
   * (wave2 2A, `cdkt-backup-drive-key:v1` — đã xoay `CHATBOT_ENCRYPTION_SECRET`).
   * Đã cấu hình nhưng không dùng được: từng tệp `failed`, không phải `none`.
   */
  driveServiceAccountUnreadable?: boolean
  driveFolderId: string
}

/** 2A: khoá service account không giải mã được — cán bộ phải dán lại khoá JSON. */
export const SERVICE_ACCOUNT_UNREADABLE_MESSAGE = 'Khoá service account không giải mã được (khoá mã hoá đã đổi) — dán lại khoá JSON ở trang Sao lưu'

export interface OffsiteFile {
  name: string
  type: 'sql' | 'media'
}

export interface OffsiteResult {
  /** Mọi tệp của lượt đã lên Drive. */
  driveUploaded: boolean
  driveError?: string
}

/**
 * Trạng thái ghi lúc ĐĂNG KÝ hàng `done`, trước bước Drive: Drive tắt thì đã biết
 * chắc là `none`; Drive bật thì để NULL cho tới khi `uploadRunOffsite` quyết định.
 */
export function offsiteStatusAtRegistration(config: Pick<OffsiteConfig, 'driveEnabled'>): OffsiteStatus | null {
  return config.driveEnabled ? null : 'none'
}

/** Ghi trạng thái cho một nhóm tệp. Không bao giờ ném — lượt sao lưu đã đăng ký vẫn là lượt thành công. */
export async function markOffsiteStatus(db: Db, names: readonly string[], status: OffsiteStatus): Promise<void> {
  if (names.length === 0) return
  try {
    await db.update(backups).set({ offsiteStatus: status }).where(inArray(backups.filename, [...names]))
  } catch (err: unknown) {
    logWarn({ event: 'backup.offsite_status_unwritten', status, files: [...names], error: err instanceof Error ? err.message : String(err) })
  }
}

type Uploader = (file: OffsiteFile) => Promise<string>

/**
 * Chọn đích upload, hoặc `null` khi Drive bật mà chưa cấu hình gì (không liên kết,
 * không service account). Ném khi đã cấu hình nhưng không dùng được — người gọi coi
 * đó là `failed`.
 */
async function resolveUploader(dir: string, stamp: string, config: OffsiteConfig): Promise<Uploader | null> {
  const { getUsableDriveLink } = await import('./backup-drive-oauth')
  const link = await getUsableDriveLink()
  const configured = offsiteDestinationConfigured({
    driveEnabled: config.driveEnabled,
    oauthLinked: link.ok || link.reason === 'secret_unreadable',
    // Một khoá đã lưu mà không mở được vẫn là "đã cấu hình" — như liên kết OAuth có
    // token không giải mã được ở dòng trên, và như trang quản trị (ô khoá hiện dấu che).
    serviceAccountConfigured: config.driveServiceAccount !== '' || config.driveServiceAccountUnreadable === true,
  })
  if (!configured) return null

  const folderId = config.driveFolderId || undefined
  if (link.ok) {
    // Mode 1: OAuth (ưu tiên — refresh token ổn định, không cần share folder).
    const { getUsableDriveOauthConfig } = await import('./backup-drive-oauth-config')
    const oauthConfig = await getUsableDriveOauthConfig()
    if (!oauthConfig.ok) throw new Error(`OAuth config (${oauthConfig.reason}) — cần cấu hình Drive OAuth trước`)
    const { uploadBackupToDriveOAuth } = await import('./backup-drive')
    return file => uploadBackupToDriveOAuth(
      path.join(dir, file.name), file.name, link.refreshToken,
      oauthConfig.clientId, oauthConfig.clientSecret, file.type, stamp, folderId,
    )
  }
  if (config.driveServiceAccount) {
    // Mode 2: Service Account (dự phòng).
    const { uploadBackupToDrive } = await import('./backup-drive')
    return file => uploadBackupToDrive(path.join(dir, file.name), file.name, config.driveServiceAccount, file.type, stamp, folderId)
  }
  // Còn lại là cấu hình không dùng được — báo cái của liên kết OAuth trước (nó được ưu
  // tiên khi dùng được), rồi tới khoá service account không giải mã được (2A).
  if (link.reason === 'secret_unreadable') throw new Error('Refresh token không giải mã được — dịch khoá hoặc liên kết lại Drive')
  throw new Error(SERVICE_ACCOUNT_UNREADABLE_MESSAGE)
}

/**
 * Đưa các tệp của một lượt lên nơi lưu ngoài máy chủ và ghi trạng thái từng tệp.
 * Không bao giờ ném: kết quả nói lượt có lên Drive đủ không, và lỗi (nếu có).
 */
export async function uploadRunOffsite(db: Db, dir: string, stamp: string, files: readonly OffsiteFile[], config: OffsiteConfig): Promise<OffsiteResult> {
  // Drive tắt: các hàng đã mang `none` từ lúc đăng ký (`offsiteStatusAtRegistration`).
  if (!config.driveEnabled || files.length === 0) return { driveUploaded: false }

  const uploaded = new Set<string>()
  try {
    const upload = await resolveUploader(dir, stamp, config)
    if (!upload) {
      // Công tắc bật mà không có đích nào: không phải lỗi Drive, nhưng bản sao lưu chỉ
      // nằm trên máy chủ — nói ra để người vận hành thấy (trang quản trị cũng cảnh báo).
      logWarn({ event: 'backup.offsite_not_configured', reason: 'drive_enabled_without_link_or_service_account', files: files.map(file => file.name) })
      await markOffsiteStatus(db, files.map(file => file.name), 'none')
      return { driveUploaded: false }
    }
    for (const file of files) {
      const fileId = await upload(file)
      uploaded.add(file.name)
      try {
        await db.update(backups).set({ driveUploaded: true, driveFileId: fileId, offsiteStatus: 'uploaded' }).where(eq(backups.filename, file.name))
      } catch (err: unknown) {
        logWarn({ event: 'backup.offsite_status_unwritten', status: 'uploaded', files: [file.name], error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { driveUploaded: true }
  } catch (err: unknown) {
    const driveError = err instanceof Error ? err.message : String(err)
    const missing = files.map(file => file.name).filter(name => !uploaded.has(name))
    logWarn({ event: 'backup.drive_failed', error: driveError, files: missing })
    await markOffsiteStatus(db, missing, 'failed')
    return { driveUploaded: false, driveError }
  }
}

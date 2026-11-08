/**
 * The Media Portal settings (`GET` / `PUT /api/admin/settings/media-portal`) — their queries,
 * moved out of the handlers verbatim. The permission checks, the field validation (400 before
 * any write), the R2-retarget rule, FFmpeg/disk probes, the response shaping and the 500 that a
 * failed save maps to stay in the handlers. The stored video-R2 values are read with
 * `readSettingValues` (admin-settings-values.ts).
 *
 * Imports nothing from h3: the handlers' tests replace all of h3 with the three names the
 * handlers use.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { mediaItems, settings, activityLogs } from '../db/schema'
import { resolveMediaConfigWithDb } from './media-config-service'
import { MASKED_SECRET } from '../../shared/settings-credential-rules'

/** The effective media config (DB > env > default) with the source of each value. */
export async function resolveMediaPortalConfig() {
  const db = getDb()
  const resolved = await resolveMediaConfigWithDb(db)
  return resolved
}

/**
 * Đếm số video theo storage_provider — video cũ = local, video mới (khi R2
 * bật) = r2. Chỉ đếm source='upload' (video thật), bỏ qua youtube (không lưu
 * trên R2/local — chỉ là link).
 */
export async function countUploadedVideosByProvider() {
  const db = getDb()
  const countRows = await db.select({
    provider: mediaItems.storageProvider,
    total: sql<number>`COUNT(*)`,
  })
    .from(mediaItems)
    .where(eq(mediaItems.source, 'upload'))
    .groupBy(mediaItems.storageProvider)
  return countRows
}

/**
 * R2 secret key rỗng = giữ nguyên (không xoá) — cán bộ chỉ muốn đổi bucket,
 * không nhập lại secret. Nhớ dbKey để skip hoàn toàn, không ghi đè rỗng.
 */
export const R2_SECRET_DB_KEY_LOCAL = 'media_video_r2_secret_key'

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

/**
 * Write the validated fields whose value differs from `current` (group `media_portal`) and,
 * when at least one did, the audit row with the before/after of each — in one transaction.
 */
export async function saveMediaPortalSettingsWithAudit(
  adminUser: { id?: number | null },
  normalized: Array<{ field: string, dbKey: string, value: string }>,
  current: Map<string, string>,
) {
  const db = getDb()

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
}

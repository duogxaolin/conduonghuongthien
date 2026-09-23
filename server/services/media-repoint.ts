/**
 * Đổi domain URL R2 cho ảnh + bài viết — 1 thao tác "bấm xong".
 *
 * Ca sử dụng: anh đổi domain CDN R2 (ví dụ `cdn.domaincu.com` →
 * `media.domainmoi.com`) nhưng **vẫn cùng R2 account + bucket**. Khi đó:
 *   - `storage_path` (key R2 `2026/09/abc.jpg`) không đổi — file đã ở R2.
 *   - Chỉ `media.url` + `articles.content` đang bake domain cũ → cần REPLACE.
 *
 * **Không tải file** (khác sync local↔R2) — chỉ update URL trong DB, < 2 giây.
 * Nên KHÔNG dùng worker nền (sync cần worker vì tải 3000 file; đổi domain không).
 *
 * **Tận dụng pattern từ `media-sync.ts`**: `REPLACE()` MySQL + pre-backup
 * snapshot SQL + audit trong transaction. Không tái发明.
 *
 * **Pre-backup SQL** (không phải file) — phòng `REPLACE` sai domain. Snapshot
 * recover thủ công, không auto-rollback (cùng lý do sync: restore toàn DB mất
 * dữ liệu unrelated).
 *
 * **Idempotent**: chạy 2 lần với cùng oldDomain → lần 2 không khớp gì (URL đã
 * đổi) → `mediaUpdated: 0`. An toàn chạy lại.
 */
import { getDb, getPool } from '../utils/db'
import { media, articles, activityLogs } from '../db/schema'
import { like, sql } from 'drizzle-orm'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { runBackup } from './backup'

const LOCK_NAME = 'cdkt:media:repoint-urls'
const LOCK_TIMEOUT_SECONDS = 0

export interface RepointResult {
  mediaUpdated: number
  articlesUpdated: number
  /** Stamp snapshot backup trước repoint (recover thủ công nếu cần). */
  backupStamp: string | null
}

/**
 * Chuẩn hoá domain: bỏ `https://`/`http://` đầu, bỏ `/` cuối. REPLACE khớp mọi
 * occurrence trong URL/HTML bất kể scheme — nhưng để an toàn, strip scheme
 * trước rồi REPLACE cả 2 dạng (http + https) nếu cần.
 *
 * Trả về domain đã strip, hoặc throw nếu không hợp lệ.
 */
function normalizeDomain(input: string, field: string): string {
  let v = input.trim()
  if (!v) throw new Error(`${field} không được để trống.`)
  // Bỏ scheme đầu — REPLACE sẽ khớp domain kể cả có http:// hay https://.
  v = v.replace(/^https?:\/\//i, '')
  // Bỏ path/query nếu cán bộ dán cả URL — chỉ lấy domain (+ path prefix nếu có).
  // Nhưng để REPLACE chính xác, giữ nguyên phần anh nhập (có thể là domain hoặc
  // domain + path prefix). Chỉ bỏ `/` cuối.
  v = v.replace(/\/+$/, '')
  if (!v) throw new Error(`${field} không hợp lệ.`)
  if (/\s/.test(v)) throw new Error(`${field} không được chứa khoảng trắng.`)
  return v
}

/**
 * Đổi domain URL R2: REPLACE trong `media.url` + `articles.content`.
 *
 * `oldDomain`/`newDomain` có thể là domain trần (`cdn.domaincu.com`) hoặc kèm
 * path prefix (`cdn.domaincu.com/media`). REPLACE khớp mọi occurrence.
 *
 * Trả số hàng `media` + `articles` đã sửa.
 */
export async function repointR2Urls(
  oldDomainRaw: string,
  newDomainRaw: string,
  adminUserId: number | null,
): Promise<RepointResult> {
  const oldDomain = normalizeDomain(oldDomainRaw, 'Domain cũ')
  const newDomain = normalizeDomain(newDomainRaw, 'Domain mới')
  if (oldDomain === newDomain) {
    throw new Error('Domain cũ và domain mới giống nhau — không có gì để đổi.')
  }

  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  // Khoá MySQL named lock — timeout 0 (không xếp hàng). Hai lượt repoint không
  // chạy chồng.
  const outcome = await withNamedLock(pool, LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    // ── Phase 1: Pre-backup SQL (snapshot recover thủ công) ─────────────────
    // Chỉ backup SQL (không file) — đổi domain chỉ chạm DB, không chạm file.
    let backupStamp: string | null = null
    try {
      const backupRes = await runBackup('sql', 'pre-repoint', adminUserId)
      backupStamp = backupRes.stamp
      logInfo({ event: 'media.repoint_pre_backup_done', stamp: backupStamp })
    } catch (err) {
      // Pre-backup fail → cảnh báo nhưng vẫn tiếp. Snapshot là bonus, repoint
      // idempotent + REPLACE chính xác nên rủi ro thấp.
      logWarn({
        event: 'media.repoint_pre_backup_failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // ── Phase 2: REPLACE + audit trong MỘT transaction ───────────────────────
    // Hai lượt UPDATE (media.url + articles.content) + dòng audit phải cùng
    // thành công hoặc cùng thất bại — cùng quy tắc `livestream.ts` đã dùng.
    const oldDomainLike = `%${oldDomain}%`

    const result = await db.transaction(async (tx) => {
      // media.url
      const [mediaRes] = await tx.execute(
        sql`UPDATE media SET url = REPLACE(url, ${oldDomain}, ${newDomain}) WHERE provider = 'r2' AND url LIKE ${oldDomainLike}`,
      )
      const mediaUpdated = affectedRowsOrZero(mediaRes)

      // articles.content
      const [articlesRes] = await tx.execute(
        sql`UPDATE articles SET content = REPLACE(content, ${oldDomain}, ${newDomain}) WHERE content LIKE ${oldDomainLike}`,
      )
      const articlesUpdated = affectedRowsOrZero(articlesRes)

      // Audit trong cùng transaction — rollback nếu audit lỗi, không để lại
      // lượt đổi domain không ai ghi.
      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: 'repoint_urls',
        resource: 'media',
        resourceId: null,
        meta: {
          oldDomain,
          newDomain,
          mediaUpdated,
          articlesUpdated,
          backupStamp,
        },
      })

      return { mediaUpdated, articlesUpdated, backupStamp }
    })

    return result
  })

  if (!outcome.acquired) {
    throw new Error('Một lượt đổi domain khác đang chạy. Thử lại sau.')
  }

  const result = outcome.value

  logInfo({
    event: 'media.repoint_complete',
    oldDomain,
    newDomain,
    mediaUpdated: result.mediaUpdated,
    articlesUpdated: result.articlesUpdated,
    backupStamp: result.backupStamp,
  })

  return result
}

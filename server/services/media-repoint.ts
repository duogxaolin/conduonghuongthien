/**
 * Đổi domain URL R2 — 1 thao tác "bấm xong" (wave2 D-REPOINT).
 *
 * Ca sử dụng: đổi domain CDN R2 (ví dụ `cdn.domaincu.com` → `media.domainmoi.com`)
 * nhưng **vẫn cùng R2 account + bucket**. Khoá R2 (`storage_path`) không đổi — file
 * đã ở R2 — chỉ những URL đã nướng domain cũ cần đổi. Không tải file, không cần
 * worker nền.
 *
 * **Phạm vi = mọi cột mang URL ảnh** (`URL_REFERENCE_TARGETS`, 27 cột — cùng danh
 * sách lượt đồng bộ local ↔ R2 dùng, kể cả khối trang, phiên bản trang, logo trong
 * `settings`, câu trả lời chatbot, bản dịch) **cộng `media.url` của hàng R2**. Bản
 * cũ chỉ đổi `media.url` + `articles.content`: 25 cột còn lại trỏ domain cũ mãi.
 *
 * **Khớp đúng ranh giới** (`domainRepointForms` ở `media-repoint-match.ts`, cùng định
 * nghĩa ranh giới với lượt đồng bộ): domain chỉ đổi khi đứng ngay sau `scheme://` và
 * trước `/` hoặc một ranh giới URL; scheme + host không phân biệt hoa thường, đường
 * dẫn có. Bản cũ `REPLACE(col, domain, …)` thay cả chuỗi con: `xold.cdn`,
 * `old.cdn.evil` bị đổi theo. Hệ quả có chủ đích: `r2_public_url` trong `settings`
 * (nếu lưu kèm scheme) cũng được đổi sang domain mới — ảnh tải lên sau đó dùng
 * domain mới; `media_video_r2_public_url` cũng vậy nếu bucket video dùng chung domain cũ.
 *
 * **Domain mới phải phục vụ được ảnh**: trong CSP `img-src` và `image.domains` của
 * NuxtImg (`shared/media-hosts.ts`, cùng nguồn `nuxt.config.ts` dựng header) — nếu
 * không, 400 trước khi chạm gì.
 *
 * **Khoá**: giữ khoá đồng bộ ảnh và khoá quét thư mục suốt lượt (xem chỗ lấy khoá).
 *
 * **Một transaction**: mọi lượt đổi + dòng audit (kèm số hàng từng cột) cùng commit
 * hoặc cùng rollback. Mỗi cột: chọn id bằng một lượt đọc KHÔNG khoá (LIKE lọc thô +
 * REGEXP có ranh giới), rồi UPDATE theo id kèm lại điều kiện REGEXP — số hàng đếm là
 * số hàng thật sự đổi (hàng chỉ chứa host giống không bao giờ được đếm), và
 * `chat_messages` không bị khoá cả bảng trong lúc đổi.
 *
 * **Sao lưu trước là bắt buộc**: `runBackup('sql', 'pre-repoint')` hỏng → dừng,
 * không hàng nào đổi (`RepointBackupError`). Bị từ chối vì đang khôi phục CSDL → cũng
 * dừng, nhưng là `JobBlockedByRestoreError` (409, "thử lại sau khi khôi phục xong") —
 * không phải lỗi đĩa. Snapshot dùng để khôi phục thủ công,
 * không tự rollback (khôi phục cả CSDL sẽ mất dữ liệu không liên quan).
 *
 * **Idempotent**: chạy lại cùng cặp domain → không khớp gì, mọi số đếm 0.
 */
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'

import { getDb, getPool, type Database } from '../utils/db'
import { activityLogs, media } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { withNamedLock } from '../utils/named-lock'
import { logError, logInfo } from '../utils/logger'
import { CSP_IMG_SRC_HOSTS, IMAGE_PROXY_DOMAINS, mediaHostProblem } from '../../shared/media-hosts'
import { runBackup } from './backup'
import { abortJobIfRestoreInProgress } from './pre-job-backup'
import { MEDIA_SCAN_LOCK_NAME } from './media-scan'
import { MEDIA_SYNC_LOCK_NAME, afterSettingsRewritten } from './media-sync-rewrite'
import { domainRepointForms, type DomainRepointForm } from './media-repoint-match'
import { URL_REFERENCE_TARGETS, assertRewritable, type ReferenceTarget } from './media-sync-url-match'

/** Không xếp hàng: một lượt ghi ảnh khác đang chạy thì trả "bận" ngay. */
const LOCK_TIMEOUT_SECONDS = 0

/** Nhãn của `media.url` (hàng R2) trong `byTarget` — nằm ngoài 27 cột tham chiếu. */
export const MEDIA_URL_TARGET_LABEL = 'media.url'

/** Số id mỗi câu UPDATE `… WHERE id IN (…)`. */
const ID_CHUNK = 500

export interface RepointResult {
  /** Hàng `media` (provider `r2`) đã đổi URL. */
  mediaUpdated: number
  /** Tổng số hàng đã đổi trên 27 cột tham chiếu. */
  contentRowsUpdated: number
  /** Số hàng đã đổi theo từng cột — đủ mọi cột, kể cả 0, cộng `media.url`. */
  byTarget: Record<string, number>
  /** Stamp bản sao lưu SQL trước khi đổi (khôi phục thủ công nếu cần). */
  backupStamp: string
}

/** Đầu vào không dùng được — endpoint trả 400. */
export class RepointInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepointInputError'
  }
}

/** Sao lưu trước khi đổi hỏng — không hàng nào đã đổi. Nguyên nhân ở log, không ở câu trả về. */
export class RepointBackupError extends Error {
  constructor() {
    super('Sao lưu CSDL trước khi đổi domain thất bại — chưa đổi URL nào. Kiểm tra dung lượng đĩa / nhật ký máy chủ rồi thử lại.')
    this.name = 'RepointBackupError'
  }
}

/** Một lượt ghi ảnh khác (đổi domain, đồng bộ/sửa URL, quét thư mục) đang chạy — endpoint trả 409. */
export class RepointBusyError extends Error {
  constructor() {
    super('Đang có lượt đồng bộ ảnh, sửa URL, quét thư mục hoặc đổi domain khác chạy. Thử lại sau khi lượt đó xong.')
    this.name = 'RepointBusyError'
  }
}

/**
 * Chuẩn hoá domain qua `URL` (W1): host chữ thường, IDN → punycode (`bücher.vn` →
 * `xn--bcher-kva.vn`), cổng khác mặc định giữ lại, tiền tố đường dẫn giữ nguyên chữ
 * (`CDN.X.VN/Media/` → `cdn.x.vn/Media`), bỏ `/` cuối. Nhận có hoặc không có `http(s)://`.
 * Từ chối tài khoản (`u:p@`), `?truy vấn`, `#`, scheme khác http(s). Ném
 * `RepointInputError` nếu không dùng được.
 */
export function normalizeRepointDomain(input: string, field: string): string {
  const raw = input.trim()
  if (!raw) throw new RepointInputError(`${field} không được để trống.`)
  if (/\s/.test(raw)) throw new RepointInputError(`${field} không được chứa khoảng trắng.`)
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
  let url: URL
  try {
    url = new URL(hasScheme ? raw : `https://${raw}`)
  } catch {
    throw new RepointInputError(`${field} không hợp lệ.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RepointInputError(`${field} phải là địa chỉ http(s).`)
  if (!url.hostname) throw new RepointInputError(`${field} không hợp lệ.`)
  if (url.username || url.password || url.search || url.hash) {
    throw new RepointInputError(`${field} chỉ gồm domain (kèm tiền tố đường dẫn nếu có) — không tài khoản, không ?truy vấn, không #.`)
  }
  return `${url.host}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Domain mới phải phục vụ được ảnh (W2): trong CSP `img-src` (nếu không, trình duyệt
 * chặn mọi ảnh vừa đổi trên toàn site) và trong `image.domains` của NuxtImg (nếu không,
 * ảnh tối ưu thành ảnh dự phòng). Cùng danh sách `nuxt.config.ts` dựng header từ đó.
 */
function assertServableImageHost(newDomain: string): void {
  const host = newDomain.split('/')[0]!
  const problem = mediaHostProblem(host)
  if (problem === 'csp') {
    throw new RepointInputError(
      `Domain mới ${host} không nằm trong nguồn ảnh CSP img-src (${CSP_IMG_SRC_HOSTS.join(', ')}) — trình duyệt sẽ chặn mọi ảnh sau khi đổi. `
      + 'Thêm host vào shared/media-hosts.ts và deploy trước, rồi mới đổi domain.',
    )
  }
  if (problem === 'ipx') {
    throw new RepointInputError(
      `Domain mới ${host} chưa có trong image.domains của NuxtImg/IPX (${IMAGE_PROXY_DOMAINS.join(', ')}) — logo và ảnh đại diện tối ưu sẽ thành ảnh dự phòng. `
      + 'Thêm host vào IMAGE_PROXY_DOMAINS ở shared/media-hosts.ts và deploy trước, rồi mới đổi domain.',
    )
  }
}

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

/** Văn bản của cột để so mẫu — cột JSON đổi sang chuỗi trước. */
function columnText(target: ReferenceTarget): SQL {
  return target.kind === 'json' ? sql`CAST(${target.column} AS CHAR)` : sql`${target.column}`
}

/** "Hàng chứa ít nhất một dạng, đúng ranh giới" — LIKE lọc thô rồi REGEXP quyết định. */
function matchesAnyForm(target: ReferenceTarget, forms: DomainRepointForm[]): SQL {
  const text = columnText(target)
  // `LOWER(…)`: mẫu LIKE là chữ thường để khớp mọi kiểu viết hoa của scheme/host, kể cả
  // trên cột JSON (so sánh theo collation nhị phân). REGEXP quyết định, có ranh giới.
  return or(...forms.map(f => sql`(LOWER(${text}) LIKE ${f.like} AND ${text} REGEXP ${f.pattern})`))!
}

/** Giá trị mới của cột: mọi dạng thay lồng nhau (các dạng rời nhau — https/http, thô/thoát `\/`). */
function rewrittenValue(target: ReferenceTarget, forms: DomainRepointForm[]): SQL {
  let value: SQL = sql`${target.column}`
  for (const form of forms) value = sql`REGEXP_REPLACE(${value}, ${form.pattern}, ${form.replacement})`
  return value
}

/** Câu chọn id các hàng chứa domain cũ đúng ranh giới. */
export function buildRepointCandidateQuery(target: ReferenceTarget, forms: DomainRepointForm[], extra?: SQL): SQL {
  const where = extra ? and(extra, matchesAnyForm(target, forms))! : matchesAnyForm(target, forms)
  return sql`SELECT ${target.id} AS id FROM ${target.table} WHERE ${where}`
}

/** Các câu đổi cho một cột trên tập id đã chọn — điều kiện REGEXP lặp lại để chỉ đếm hàng thật sự đổi. */
export function buildRepointUpdates(
  target: ReferenceTarget,
  forms: DomainRepointForm[],
  ids: readonly (number | string)[],
): SQL[] {
  const out: SQL[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    out.push(sql`UPDATE ${target.table} SET ${target.column} = ${rewrittenValue(target, forms)} WHERE ${inArray(target.id, [...chunk])} AND ${matchesAnyForm(target, forms)}`)
  }
  return out
}

function readIds(result: unknown): (number | string)[] {
  const rows = Array.isArray(result) ? result[0] : result
  if (!Array.isArray(rows)) return []
  const ids: (number | string)[] = []
  for (const row of rows) {
    const id = row && typeof row === 'object' ? (row as Record<string, unknown>).id : undefined
    if (typeof id === 'number' || typeof id === 'string') ids.push(id)
    else if (typeof id === 'bigint') ids.push(Number(id))
  }
  return ids
}

/** `media` như một cột tham chiếu — chỉ hàng R2 (`extra`). */
const MEDIA_URL_TARGET: ReferenceTarget = { label: MEDIA_URL_TARGET_LABEL, table: media, id: media.id, column: media.url, kind: 'text' }

async function repointTarget(exec: Executor, target: ReferenceTarget, oldDomain: string, newDomain: string, extra?: SQL): Promise<number> {
  const forms = domainRepointForms(target.kind, oldDomain, newDomain)
  const ids = readIds(await exec.execute(buildRepointCandidateQuery(target, forms, extra)))
  let changed = 0
  for (const query of buildRepointUpdates(target, forms, ids)) {
    const [result] = await exec.execute(query)
    changed += affectedRowsOrZero(result)
  }
  return changed
}

/**
 * Đổi domain URL R2 ở `media.url` (hàng R2) và mọi cột tham chiếu, trong một
 * transaction cùng dòng audit. Trả số hàng đã đổi theo từng cột.
 */
export async function repointR2Urls(
  oldDomainRaw: string,
  newDomainRaw: string,
  adminUserId: number | null,
): Promise<RepointResult> {
  const oldDomain = normalizeRepointDomain(oldDomainRaw, 'Domain cũ')
  const newDomain = normalizeRepointDomain(newDomainRaw, 'Domain mới')
  if (oldDomain === newDomain) {
    throw new RepointInputError('Domain cũ và domain mới giống nhau — không có gì để đổi.')
  }
  assertServableImageHost(newDomain)
  // Domain mới chứa domain cũ (`cdn.x.vn` → `cdn.x.vn/v2`): lượt đổi không còn
  // idempotent — chạy lại sẽ nối thêm. Ký tự phá HTML/JSON cũng bị chặn ở đây.
  try {
    assertRewritable({ oldUrl: oldDomain, newUrl: newDomain })
  } catch (err: unknown) {
    throw new RepointInputError(`Domain không đổi được: ${err instanceof Error ? err.message : String(err)}`)
  }

  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  // Khoá (W4): lượt đổi giữ khoá của MỌI lượt ghi ảnh dựng URL R2 từ `r2_public_url` —
  // đồng bộ local ↔ R2 + "Sửa URL" (`MEDIA_SYNC_LOCK_NAME`) và quét thư mục tự đẩy R2
  // (`MEDIA_SCAN_LOCK_NAME`). Chạy song song, chúng đọc domain CŨ lúc bắt đầu và ghi
  // hàng/nội dung mang domain cũ SAU khi lượt đổi đã commit — lượt đổi "xong" mà URL
  // cũ vẫn mọc thêm. Khoá đồng bộ cũng chặn hai lượt đổi domain chạy chồng. Timeout 0,
  // luôn cùng thứ tự (đồng bộ → quét): không chờ, không deadlock.
  const locked = await withNamedLock(pool, MEDIA_SYNC_LOCK_NAME, LOCK_TIMEOUT_SECONDS, () => withNamedLock(pool, MEDIA_SCAN_LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    // ── Phase 1: sao lưu SQL — bắt buộc ─────────────────────────────────────
    let backupStamp: string
    try {
      backupStamp = (await runBackup('sql', 'pre-repoint', adminUserId)).stamp
    } catch (err: unknown) {
      // Đang khôi phục CSDL: không phải "sao lưu hỏng" (đĩa/nhật ký) mà là "chưa phải
      // lúc" — 409 với câu riêng (`pre-job-backup.ts`). Mọi lỗi khác vẫn dừng như cũ.
      abortJobIfRestoreInProgress(err, 'repoint', 'đổi domain')
      logError({
        event: 'media.repoint_pre_backup_failed',
        oldDomain,
        newDomain,
        error: err instanceof Error ? err.message : String(err),
      })
      throw new RepointBackupError()
    }
    logInfo({ event: 'media.repoint_pre_backup_done', stamp: backupStamp })

    // ── Phase 2: mọi lượt đổi + audit trong MỘT transaction ─────────────────
    return db.transaction(async (tx) => {
      const byTarget: Record<string, number> = {}
      byTarget[MEDIA_URL_TARGET_LABEL] = await repointTarget(tx, MEDIA_URL_TARGET, oldDomain, newDomain, eq(media.provider, 'r2'))
      let contentRowsUpdated = 0
      for (const target of URL_REFERENCE_TARGETS) {
        const n = await repointTarget(tx, target, oldDomain, newDomain)
        byTarget[target.label] = n
        contentRowsUpdated += n
      }
      const mediaUpdated = byTarget[MEDIA_URL_TARGET_LABEL]!

      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: 'repoint_urls',
        resource: 'media',
        resourceId: null,
        meta: { oldDomain, newDomain, mediaUpdated, contentRowsUpdated, byTarget, backupStamp },
      })
      return { mediaUpdated, contentRowsUpdated, byTarget, backupStamp }
    })
  }))

  if (!locked.acquired || !locked.value.acquired) throw new RepointBusyError()

  const result = locked.value.value
  // Sau commit: bộ đệm favicon/og:image không được giữ URL domain cũ.
  afterSettingsRewritten(result.byTarget)
  logInfo({
    event: 'media.repoint_complete',
    oldDomain,
    newDomain,
    mediaUpdated: result.mediaUpdated,
    contentRowsUpdated: result.contentRowsUpdated,
    backupStamp: result.backupStamp,
  })
  return result
}

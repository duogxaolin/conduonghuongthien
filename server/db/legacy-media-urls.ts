/**
 * `repairLegacyMediaUrls` — gọi từ `applyAdditiveMigrations` (`migrations-additive.ts`),
 * tức chạy MỖI lần khởi động. Các mảnh thuần ở đây kiểm được không cần MySQL
 * (`tests/legacy-media-urls.test.ts`); kết quả trên MySQL thật do
 * `tests/schema-upgrade-integration.test.ts` kiểm (khai báo
 * `additive.repair-legacy-media-urls`). Tách khỏi `migrations-additive.ts` ở wave2
 * D-SCAN — tệp đó đã quá 900 dòng.
 *
 * Lượt vá trỏ liên kết cũ `…/uploads/migrated/media/<tên tệp>` trong bài viết về
 * URL R2 của hàng `media` mang đúng tên tệp. Ba điều wave2 D-SCAN sửa:
 *
 *   - **Tên tệp mơ hồ không được ánh xạ.** Hai hàng `media` (bất kể provider) cùng
 *     tên tệp mà KHÁC URL — `2026/09/a.jpg` và `2026/10/a.jpg` sau một lượt quét — thì liên kết
 *     `migrated/media/a.jpg` không cho biết ảnh nào. Bản cũ lấy hàng đọc sau cùng
 *     (`Map.set` ghi đè), tức là trỏ bài viết vào một ảnh có thể khác. Nay: bỏ qua,
 *     giữ nguyên liên kết, và log tên tệp (`db.migration.legacy_media_ambiguous`).
 *     Mơ hồ tính trên KHOÁ cuối cùng của bảng ánh xạ, gồm cả dạng
 *     `encodeURIComponent` (một tên tệp có thể trùng dạng mã hoá của tên khác).
 *   - **Domain lấy từ cấu hình** (`settings.r2_public_url`) thay cho `cdn1.delify.vn`
 *     viết cứng; chưa cấu hình → bỏ các bước cần domain (log
 *     `db.migration.legacy_media_domain_unknown` khi còn URL đang chờ vá).
 *   - **`UPDATE articles` giữ `updated_at`** (`updated_at = updated_at`): vá URL không
 *     phải một lần cán bộ sửa bài.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise'

import { BOOT_MIGRATION_EVENTS, logWarn } from '../utils/logger'

function safeEncodeComponent(s: string): string {
  try { return encodeURIComponent(s) } catch { return s }
}

/**
 * Domain công khai R2 đã cấu hình, dạng `host[/tiền tố]` (không scheme, không `/`
 * cuối) — hoặc `null` khi chưa cấu hình / không dùng được.
 */
export function legacyMediaDomain(r2PublicUrl: unknown): string | null {
  if (typeof r2PublicUrl !== 'string') return null
  const domain = r2PublicUrl.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (!domain || /[\s"'<>\\`]/.test(domain)) return null
  return domain
}

/** Mẫu LIKE "bắt đầu bằng": `%`, `_`, `\` trong domain là chữ, không phải ký tự đại diện. */
export function likePrefix(s: string): string {
  return `${s.replace(/[\\%_]/g, '\\$&')}%`
}

/** Mẫu LIKE "chứa chuỗi". */
export function likeContains(s: string): string {
  return `%${likePrefix(s)}`
}

export interface MigratedMediaMap {
  /** Tên tệp (thô hoặc mã hoá) → URL R2 của hàng DUY NHẤT mang tên đó. */
  urlByName: Map<string, string>
  /** Khoá mà hơn một hàng `media` cùng mang — không ánh xạ. */
  ambiguous: Set<string>
}

/**
 * Mọi hàng `media` (mọi provider) → bảng ánh xạ tên tệp → URL R2, bỏ khoá mơ hồ.
 * Mơ hồ = khoá dẫn tới HƠN MỘT URL khác nhau (S1): hai hàng trùng chung một URL (cùng
 * một object) không làm liên kết mơ hồ — đích của nó là duy nhất.
 */
export function buildMigratedMediaMap(rows: ReadonlyArray<{ filename: unknown; url: unknown; provider: unknown }>): MigratedMediaMap {
  /** khoá → URL → có hàng R2 nào mang URL đó không. */
  const owners = new Map<string, Map<string, boolean>>()
  for (const row of rows) {
    const filename = typeof row.filename === 'string' ? row.filename : ''
    if (!filename) continue
    const url = typeof row.url === 'string' ? row.url : ''
    for (const key of new Set([filename, safeEncodeComponent(filename)])) {
      const urls = owners.get(key) ?? new Map<string, boolean>()
      urls.set(url, (urls.get(url) ?? false) || row.provider === 'r2')
      owners.set(key, urls)
    }
  }
  const urlByName = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [key, urls] of owners) {
    if (urls.size > 1) {
      ambiguous.add(key)
      continue
    }
    for (const [url, onR2] of urls) {
      if (onR2 && url) urlByName.set(key, url)
    }
  }
  return { urlByName, ambiguous }
}

const ABSOLUTE_MIGRATED = /https?:\/\/[^\s"'<>]*\/uploads\/[^\s"'<>]*migrated\/media\/([^\s"'<>\]?#]+)/g
const RELATIVE_MIGRATED = /\/uploads\/migrated\/media\/([^\s"'<>\]?#]+)/g

/**
 * Thay liên kết `…/uploads/migrated/media/<tên>` (tuyệt đối trước, rồi tương đối)
 * bằng URL R2 của tên đó. Tên không có trong bảng, hoặc mơ hồ, giữ nguyên; tên mơ hồ
 * gặp trong nội dung được trả về để log.
 */
export function rewriteMigratedMediaLinks(content: string, map: MigratedMediaMap): { content: string; ambiguousSeen: Set<string> } {
  const ambiguousSeen = new Set<string>()
  const swap = (match: string, filename: string) => {
    const url = map.urlByName.get(filename)
    if (url) return url
    if (map.ambiguous.has(filename)) ambiguousSeen.add(filename)
    return match
  }
  const next = content.replace(ABSOLUTE_MIGRATED, swap).replace(RELATIVE_MIGRATED, swap)
  return { content: next, ambiguousSeen }
}

/**
 * Tự vá URL ảnh hỏng hàng loạt còn sót sau lần sync treo pre-backup.
 * Chạy mỗi lần khởi động, idempotent, không backup (migration đã là idempotent).
 * Không throw — lỗi chỉ log, không chặn khởi động.
 */
export async function repairLegacyMediaUrls(db: Connection) {
  try {
    const [domainRows] = await db.execute<RowDataPacket[]>(
      "SELECT `value` FROM `settings` WHERE `key` = 'r2_public_url' LIMIT 1",
    ).catch(() => [[] as RowDataPacket[]] as const)
    const domain = legacyMediaDomain((domainRows as RowDataPacket[])[0]?.value)

    // 1) media.url: bóc localhost prefix + thêm scheme — chỉ chạy khi thật sự có hàng lỗi
    const [mediaNeed] = await (domain
      ? db.execute<RowDataPacket[]>(
        "SELECT 1 FROM `media` WHERE `url` LIKE 'http://localhost:3000%' OR `url` LIKE 'https://localhost:3000%' OR (`url` NOT LIKE 'http%' AND `url` LIKE ?) LIMIT 1",
        [likePrefix(domain)],
      )
      : db.execute<RowDataPacket[]>(
        "SELECT 1 FROM `media` WHERE `url` LIKE 'http://localhost:3000%' OR `url` LIKE 'https://localhost:3000%' LIMIT 1",
      )).catch(() => [[] as RowDataPacket[]] as const)
    if ((mediaNeed as RowDataPacket[]).length > 0) {
      await db.query(`UPDATE \`media\` SET \`url\` = REPLACE(\`url\`, 'http://localhost:3000', '') WHERE \`url\` LIKE 'http://localhost:3000http%'`).catch(() => {})
      await db.query(`UPDATE \`media\` SET \`url\` = REPLACE(\`url\`, 'https://localhost:3000', '') WHERE \`url\` LIKE 'https://localhost:3000http%'`).catch(() => {})
      if (domain) {
        await db.query(`UPDATE \`media\` SET \`url\` = REPLACE(\`url\`, 'http://localhost:3000/', '') WHERE \`url\` LIKE ?`, [likePrefix(`http://localhost:3000/${domain}`)]).catch(() => {})
        await db.query(`UPDATE \`media\` SET \`url\` = REPLACE(\`url\`, 'https://localhost:3000/', '') WHERE \`url\` LIKE ?`, [likePrefix(`https://localhost:3000/${domain}`)]).catch(() => {})
        await db.query(`UPDATE \`media\` SET \`url\` = CONCAT('https://', \`url\`) WHERE \`url\` NOT LIKE 'http%' AND \`url\` LIKE ?`, [likePrefix(domain)]).catch(() => {})
      }
    }

    // 2) articles.content: double-prefix — cũng guard
    const [articleDouble] = await (domain
      ? db.execute<RowDataPacket[]>(
        "SELECT 1 FROM `articles` WHERE `content` LIKE '%localhost:3000https://%' OR `content` LIKE ? LIMIT 1",
        [likeContains(`localhost:3000/${domain}`)],
      )
      : db.execute<RowDataPacket[]>(
        "SELECT 1 FROM `articles` WHERE `content` LIKE '%localhost:3000https://%' LIMIT 1",
      )).catch(() => [[] as RowDataPacket[]] as const)
    if ((articleDouble as RowDataPacket[]).length > 0) {
      await db.query(`UPDATE \`articles\` SET \`content\` = REPLACE(\`content\`, 'http://localhost:3000https://', 'https://'), \`updated_at\` = \`updated_at\` WHERE \`content\` LIKE '%http://localhost:3000https://%'`).catch(() => {})
      await db.query(`UPDATE \`articles\` SET \`content\` = REPLACE(\`content\`, 'https://localhost:3000https://', 'https://'), \`updated_at\` = \`updated_at\` WHERE \`content\` LIKE '%https://localhost:3000https://%'`).catch(() => {})
      if (domain) {
        for (const scheme of ['http', 'https']) {
          const from = `${scheme}://localhost:3000/${domain}`
          await db.query(
            `UPDATE \`articles\` SET \`content\` = REPLACE(\`content\`, ?, ?), \`updated_at\` = \`updated_at\` WHERE \`content\` LIKE ?`,
            [from, `https://${domain}`, likeContains(from)],
          ).catch(() => {})
        }
      }
    }
    if (!domain) {
      // URL `localhost:3000/<domain>/…` còn chờ vá mà không biết domain R2 nào.
      const [waiting] = await db.execute<RowDataPacket[]>(
        "SELECT 1 FROM `media` WHERE (`url` LIKE 'http://localhost:3000/%' OR `url` LIKE 'https://localhost:3000/%') AND `url` NOT LIKE '%://localhost:3000/uploads/%' LIMIT 1",
      ).catch(() => [[] as RowDataPacket[]] as const)
      if ((waiting as RowDataPacket[]).length > 0) logWarn({ event: BOOT_MIGRATION_EVENTS.legacyMediaDomainUnknown })
    }

    // 3) Thay URL `*/uploads/migrated/media/<file>` (cả relative + absolute) bằng
    //    `media.url` R2 đúng — all bài, làm trong 1 lượt đọc/ghi (theo id).
    //
    // Trước đây lặp từng filename × (REGEXP_REPLACE scan cả cột LONGTEXT +
    // REPLACE scan lại) = ~1920 quét full bảng, treo container 95s+ ở 960 file.
    // Giờ: đọc mỗi bài 1 lần, ghép filename→url trong JS (Map lookup O(1)),
    // thay bằng regex JS (absolute prefix bắt `https?://host/uploads/...`),
    // UPDATE 1 câu mỗi bài. Scan articles chỉ 1 lần.
    const [migratedNeed] = await db.execute<RowDataPacket[]>(
      "SELECT 1 FROM `articles` WHERE `content` LIKE '%/uploads/migrated/media/%' LIMIT 1",
    ).catch(() => [[] as RowDataPacket[]] as const)
    if ((migratedNeed as RowDataPacket[]).length === 0) return

    // MỌI hàng (mọi provider): một tên tệp mà hai hàng cùng mang là mơ hồ, kể cả khi
    // chỉ một trong hai ở R2. URL trong articles có thể URL-encoded
    // (`t%E1%BA%A3i%20xu%E1%BB%91ng.jpg`) trong khi `media.filename` lưu raw —
    // bảng ánh xạ có cả hai dạng.
    const [mediaRows] = await db.execute<RowDataPacket[]>(
      'SELECT `filename`, `url`, `provider` FROM `media` WHERE `filename` IS NOT NULL',
    ).catch(() => [[] as RowDataPacket[]] as const)
    const map = buildMigratedMediaMap((mediaRows as RowDataPacket[]).map(row => ({ filename: row.filename, url: row.url, provider: row.provider })))
    if (map.urlByName.size === 0 && map.ambiguous.size === 0) return

    const [articleRows] = await db.execute<RowDataPacket[]>(
      "SELECT `id`, `content` FROM `articles` WHERE `content` LIKE '%/uploads/migrated/media/%'",
    )
    const ambiguousSeen = new Set<string>()
    let articlesWithAmbiguous = 0
    for (const row of articleRows as RowDataPacket[]) {
      const id = (row as Record<string, unknown>).id as number | undefined
      const original = (row as Record<string, unknown>).content
      if (id === undefined || original === null) continue
      const content = String(original)
      const rewritten = rewriteMigratedMediaLinks(content, map)
      if (rewritten.ambiguousSeen.size > 0) {
        articlesWithAmbiguous += 1
        for (const name of rewritten.ambiguousSeen) ambiguousSeen.add(name)
      }
      if (rewritten.content !== content) {
        await db.query('UPDATE `articles` SET `content` = ?, `updated_at` = `updated_at` WHERE `id` = ?', [rewritten.content, id])
      }
    }
    if (ambiguousSeen.size > 0) {
      logWarn({
        event: BOOT_MIGRATION_EVENTS.legacyMediaAmbiguous,
        filenames: [...ambiguousSeen].slice(0, 20),
        filenameCount: ambiguousSeen.size,
        articles: articlesWithAmbiguous,
      })
    }
  } catch { /* không chặn khởi động */ }
}

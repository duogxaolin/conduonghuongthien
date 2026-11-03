/**
 * Nhóm default seed MỘT LẦN cho mỗi CSDL (wave2 D7).
 *
 * Container chạy `seed.ts` ở MỖI lần khởi động (Dockerfile CMD: `init.ts` → `seed.ts`
 * → server). Bản cũ chèn lại mọi default còn thiếu theo khoá tự nhiên mỗi lần đó, nên
 * luật kiểm duyệt, mạng xã hội, danh mục video, thể loại, danh mục bài viết mà cán bộ
 * đã XOÁ quay lại sau mỗi deploy / mỗi lần `restart: always`. Thể loại và danh mục
 * bài viết còn được chèn ngay trong tệp DDL (`schema-tables/core.ts`, `content.ts`) —
 * nay chuyển về đây, tệp DDL chỉ còn DDL.
 *
 * **Dấu theo phiên bản bộ default**: `seed.<nhóm>.v<N>.done` trong `settings` (nhóm
 * `internal`, giá trị = giờ ISO). Mỗi bộ của một nhóm:
 *   1. đã có dấu → bỏ qua;
 *   2. chưa có dấu, là v1 và bảng ĐÃ có hàng → chỉ ghi dấu (CSDL có từ trước khi có
 *      dấu: default đã được seed bởi mã cũ, cái nào vắng là cán bộ đã xoá);
 *   3. còn lại → chèn các default của bộ mà khoá tự nhiên chưa có, rồi ghi dấu.
 * Bản phát hành sau thêm default cho một nhóm thì thêm bộ `v2` CHỈ gồm hàng mới: CSDL
 * đang chạy nhận chúng đúng một lần, default v1 đã xoá vẫn xoá. Không bao giờ sửa
 * một bộ đã phát hành — CSDL đã có dấu của nó sẽ không bao giờ thấy thay đổi.
 *
 * Mỗi bộ chạy trong MỘT transaction, dấu ghi TRƯỚC: bản sao thứ hai chạy seed cùng
 * lúc chờ trên khoá của hàng dấu, rồi nhận ER_DUP_ENTRY và bỏ qua — không chèn đôi.
 * Chết giữa chừng → rollback cả dấu lẫn hàng, lượt sau làm lại từ đầu.
 *
 * Dấu không bao giờ được trả qua API: mọi lượt đọc `settings` là allowlist khoá
 * (`SETTINGS_READ_KEYS`, allowlist công khai, `backup.get`), `ALLOWED_SETTING_KEYS`
 * không nhận khoá `seed.` — `tests/seed-markers-settings-read.test.ts`. Muốn seed lại
 * một nhóm: xoá hàng dấu của bộ đó (`production/README.md`).
 */
import { eq, sql } from 'drizzle-orm'
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core'

import type { Database } from '../utils/db'
import { aiModerationRules, categories, contentTypes, mediaCategories, settings, socialLinks } from './schema'

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export const SEED_MARKER_PREFIX = 'seed.'
/** Nhóm `settings` của hàng dấu — cùng nhóm với `backup_scheduler_state`. */
export const SEED_MARKER_SETTINGS_GROUP = 'internal'

export type SeedGroupName = 'moderation_rules' | 'social_links' | 'media_categories' | 'content_types' | 'categories'

export function seedMarkerKey(group: SeedGroupName, version: number): string {
  return `${SEED_MARKER_PREFIX}${group}.v${version}.done`
}

/** Khoá `settings` là dấu seed — không bao giờ đọc/ghi qua API cài đặt. */
export function isSeedMarkerKey(key: string): boolean {
  return key.startsWith(SEED_MARKER_PREFIX)
}

export interface SeedDefaultSet<Row> {
  version: number
  rows: readonly Row[]
}

export interface SeedGroupSpec<Row, Insert = Record<string, unknown>> {
  name: SeedGroupName
  table: MySqlTable
  /** Cột khoá tự nhiên — một default "đã có" khi một hàng mang khoá đó (theo collation của cột). */
  keyColumn: MySqlColumn
  keyOf: (row: Row) => string
  sets: readonly SeedDefaultSet<Row>[]
  /**
   * ĐÚNG giá trị seed ghi cho một hàng default (tên thuộc tính Drizzle). `allRows` =
   * mọi default của nhóm theo thứ tự bộ (cho thứ tự hiển thị). Suite nâng cấp so hàng
   * được chèn với chính kết quả này — nên mọi biến đổi lúc ghi phải nằm ở đây.
   */
  toInsert: (row: Row, allRows: readonly Row[]) => Insert
  insert: (tx: Executor, values: Insert[]) => Promise<void>
}

export interface SeedGroup {
  name: SeedGroupName
  sets: ReadonlyArray<{ version: number; keys: readonly string[] }>
  /** Chạy một bộ trong transaction đã mở. */
  applySet: (tx: Executor, version: number) => Promise<{ result: 'bootstrapped' | 'seeded'; inserted: number }>
}

export function defineSeedGroup<Row, Insert>(spec: SeedGroupSpec<Row, Insert>): SeedGroup {
  const versions = spec.sets.map(set => set.version)
  if (versions.some(v => !Number.isSafeInteger(v) || v < 1) || new Set(versions).size !== versions.length) {
    throw new Error(`seed group ${spec.name}: versions must be distinct positive integers, got ${versions.join(', ')}`)
  }
  if (!versions.includes(1)) throw new Error(`seed group ${spec.name}: v1 is missing`)
  const allRows = [...spec.sets].sort((a, b) => a.version - b.version).flatMap(set => set.rows)
  const allKeys = allRows.map(spec.keyOf)
  if (new Set(allKeys).size !== allKeys.length) {
    throw new Error(`seed group ${spec.name}: a default key appears twice — a later set must only add new rows`)
  }
  return {
    name: spec.name,
    sets: spec.sets.map(set => ({ version: set.version, keys: set.rows.map(spec.keyOf) })),
    async applySet(tx, version) {
      const set = spec.sets.find(s => s.version === version)
      if (!set) throw new Error(`seed group ${spec.name} has no v${version}`)
      if (version === 1) {
        const [counted] = await tx.select({ n: sql<number>`COUNT(*)` }).from(spec.table)
        if (Number(counted?.n ?? 0) > 0) return { result: 'bootstrapped', inserted: 0 }
      }
      // Một lượt kiểm mỗi hàng, theo collation của cột — cùng phép so mà chỉ mục
      // UNIQUE (slug) dùng, nên không bao giờ chèn một khoá mà CSDL coi là trùng.
      const missing: Row[] = []
      for (const row of set.rows) {
        const [present] = await tx.select({ k: spec.keyColumn }).from(spec.table).where(eq(spec.keyColumn, spec.keyOf(row))).limit(1)
        if (!present) missing.push(row)
      }
      if (missing.length > 0) await spec.insert(tx, missing.map(row => spec.toInsert(row, allRows)))
      return { result: 'seeded', inserted: missing.length }
    },
  }
}

// ─── Bộ default ──────────────────────────────────────────────────────────────

export interface ModerationRuleSeed { category: string; ruleType: string; pattern: string; action: string; severity: string }
export interface SocialLinkSeed { platform: string; label: string; url: string; icon: string; iconType: string; color: string }
export interface MediaCategorySeed { name: string; slug: string; displayOrder: number; description?: string }
export interface ContentTypeSeed { name: string; slug: string; icon: string; displayOrder: number }
export interface CategorySeed { name: string; slug: string; type: string; displayOrder: number; description?: string }

// System content types (Thể Loại). isSystem=true → editable but not deletable
// (fixed public pages depend on them). Trước đây cũng được chèn ở `core.ts`.
export const DEFAULT_CONTENT_TYPES: readonly ContentTypeSeed[] = [
  { name: 'Bản tin & Tin tức',     slug: 'news',          icon: 'fa-solid fa-newspaper',        displayOrder: 1 },
  { name: 'Tấm gương tiêu biểu',   slug: 'role_model',    icon: 'fa-solid fa-award',            displayOrder: 2 },
  { name: 'Mô hình tái hòa nhập',  slug: 'reintegration', icon: 'fa-solid fa-people-roof',      displayOrder: 3 },
  { name: 'Văn bản pháp luật',     slug: 'document',      icon: 'fa-solid fa-file-lines',       displayOrder: 4 },
  { name: 'Giải đáp pháp luật',    slug: 'faq',           icon: 'fa-solid fa-circle-question',  displayOrder: 5 },
]

// Default article categories. News slugs match the legacy hardcoded slugs.
// Trước đây cũng được chèn ở `content.ts` — bản DDL không có mô tả và chạy TRƯỚC
// seed, nên CSDL mới mất mô tả của ba danh mục; nay chỉ còn bản này.
export const DEFAULT_CATEGORIES: readonly CategorySeed[] = [
  { name: 'Tin nổi bật',      slug: 'tin-noi-bat',      type: 'news',          displayOrder: 1 },
  { name: 'Tin hoạt động',    slug: 'tin-hoat-dong',    type: 'news',          displayOrder: 2 },
  { name: 'Tin địa phương',   slug: 'tin-dia-phuong',   type: 'news',          displayOrder: 3, description: 'Hoạt động về thi hành án hình sự và tái hòa nhập cộng đồng tại địa bàn xã, phường' },
  { name: 'Tấm gương tiêu biểu', slug: 'tam-guong-tieu-bieu', type: 'role_model',   displayOrder: 1 },
  { name: 'Mô hình tái hòa nhập', slug: 'mo-hinh-tai-hoa-nhap', type: 'reintegration', displayOrder: 1 },
  { name: 'Văn bản pháp luật', slug: 'van-ban-phap-luat', type: 'document',      displayOrder: 1, description: 'Tra cứu các chỉ thị, nghị định và chính sách về công tác thi hành án hình sự, hỗ trợ tái hòa nhập cộng đồng' },
  { name: 'Hỏi đáp pháp luật', slug: 'hoi-dap-phap-luat', type: 'faq',           displayOrder: 1, description: 'Ngân hàng câu hỏi, giải đáp về vay vốn và đào tạo nghề, thủ tục tái hòa nhập cộng đồng' },
]

// Danh mục mặc định cho Media Portal (video). Tách khỏi `DEFAULT_CATEGORIES`
// (bài viết) — bảng `media_categories` riêng, phẳng.
export const DEFAULT_MEDIA_CATEGORIES: readonly MediaCategorySeed[] = [
  { name: 'Video hoạt động',    slug: 'video-hoat-dong',    displayOrder: 1, description: 'Video về hoạt động nghiệp vụ, sự kiện của Cục C11 và địa phương' },
  { name: 'Video hướng dẫn',    slug: 'video-huong-dan',    displayOrder: 2, description: 'Video hướng dẫn thủ tục, quy trình tái hòa nhập cộng đồng' },
  { name: 'Phóng sự - Tư liệu', slug: 'phong-su-tu-lieu',   displayOrder: 3, description: 'Phóng sự, tư liệu về tấm gương hoàn lương và mô hình tái hòa nhập' },
  { name: 'Video tuyên truyền', slug: 'video-tuyen-truyen', displayOrder: 4, description: 'Video tuyên truyền pháp luật, phổ biến chính sách' },
]

// Default AI Security & Moderation Rules.
// Ranh giới đi cùng từ động từ xúc phạm: chỉ chặn phát ngôn lăng mạ cá nhân lãnh tụ,
// KHÔNG chặn quan điểm chính trị đối lập (Việt Nam Cộng Hòa / VNCH muôn năm / "tay
// sai Mỹ" đều ĐƯỢC PHÉP — đó là quan điểm, không phải xúc phạm cá nhân). Pattern kết
// hợp "động từ xúc phạm + tên lãnh tụ" để keyword matching không chặn ca cảnh giác /
// giải pháp pháp luật / dẫn chứng lịch sử.
// `action: "auto_hide"` (nháy kép, như bản gốc ở seed.ts) là HÀNH ĐỘNG CỦA LUẬT, không
// phải hành động kiểm toán: `tests/activity-log-labels.test.ts` quét `action: '…'`
// nháy đơn trên toàn `server/` để đòi nhãn cho mọi hành động ghi vào `activity_logs`.
export const DEFAULT_MODERATION_RULES: readonly ModerationRuleSeed[] = [
  { category: 'hostile_forces', ruleType: 'keyword', pattern: 'việt tân', action: "auto_hide", severity: 'critical' },
  { category: 'hostile_forces', ruleType: 'keyword', pattern: 'triều đại việt', action: "auto_hide", severity: 'critical' },
  { category: 'hostile_forces', ruleType: 'keyword', pattern: 'chính phủ quốc gia việt nam lâm thời', action: "auto_hide", severity: 'critical' },
  { category: 'hostile_forces', ruleType: 'keyword', pattern: 'khủng bố', action: "auto_hide", severity: 'critical' },
  { category: 'anti_state', ruleType: 'keyword', pattern: 'lật đổ chính quyền', action: "auto_hide", severity: 'critical' },
  { category: 'anti_state', ruleType: 'keyword', pattern: 'xuyên tạc chính sách', action: "auto_hide", severity: 'high' },
  { category: 'anti_state', ruleType: 'keyword', pattern: 'biểu tình bạo loạn', action: "auto_hide", severity: 'critical' },
  { category: 'anti_state', ruleType: 'keyword', pattern: 'chống phá đảng', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'xúc phạm danh dự công an', action: "auto_hide", severity: 'high' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'bôi nhọ lãnh đạo', action: "auto_hide", severity: 'high' },
  // ── Xúc phạm cố lãnh đạo được tôn kính (Bác Hồ, Bác Giáp, Chủ tịch Hồ Chí Minh) ──
  { category: 'defamation', ruleType: 'keyword', pattern: 'lăng mạ bác hồ', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'xúc phạm bác hồ', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'bôi nhọ bác hồ', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'mạ lị bác hồ', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'nhục mạ bác hồ', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'lăng mạ chủ tịch hồ chí minh', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'xúc phạm chủ tịch hồ chí minh', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'bôi nhọ chủ tịch hồ chí minh', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'lăng mạ bác giáp', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'xúc phạm bác giáp', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'bôi nhọ đại tướng võ nguyên giáp', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'lăng mạ lãnh tụ', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'xúc phạm lãnh tụ', action: "auto_hide", severity: 'critical' },
  { category: 'defamation', ruleType: 'keyword', pattern: 'mạ lị lãnh tụ', action: "auto_hide", severity: 'critical' },
  { category: 'spam_fraud', ruleType: 'keyword', pattern: 'cờ bạc online', action: "auto_hide", severity: 'high' },
  { category: 'spam_fraud', ruleType: 'keyword', pattern: 'tài xỉu', action: "auto_hide", severity: 'high' },
  { category: 'spam_fraud', ruleType: 'keyword', pattern: 'vay tiền nóng', action: "auto_hide", severity: 'medium' },
  { category: 'spam_fraud', ruleType: 'keyword', pattern: 'lừa đảo', action: "auto_hide", severity: 'medium' },
]

// MXH nổi tiếng + màu brand chính thức. Admin có thể sửa/xóa/thêm sau. `icon` dùng
// Font Awesome brands (đã self-host) cho logo sắc nét; `color` là mã hex brand.
export const DEFAULT_SOCIAL_LINKS: readonly SocialLinkSeed[] = [
  { platform: 'Facebook',  label: 'Fanpage C11',           url: 'https://facebook.com/conduonghuongthien', icon: 'fa-brands fa-facebook-f', iconType: 'fontawesome', color: '#1877f2' },
  { platform: 'YouTube',   label: 'Kênh YouTube C11',      url: 'https://youtube.com/@conduonghuongthien',  icon: 'fa-brands fa-youtube',    iconType: 'fontawesome', color: '#ff0000' },
  { platform: 'Zalo',      label: 'Zalo Official Account', url: 'https://zalo.me/conduonghuongthien',      icon: '/assets/social/zalo.svg', iconType: 'svg',        color: '#0068ff' },
  { platform: 'TikTok',    label: 'TikTok C11',            url: 'https://tiktok.com/@conduonghuongthien',  icon: 'fa-brands fa-tiktok',     iconType: 'fontawesome', color: '#000000' },
  { platform: 'Telegram',  label: 'Kênh Telegram C11',    url: 'https://t.me/conduonghuongthien',          icon: 'fa-brands fa-telegram',   iconType: 'fontawesome', color: '#0088cc' },
  { platform: 'Instagram', label: 'Instagram C11',         url: 'https://instagram.com/conduonghuongthien', icon: 'fa-brands fa-instagram', iconType: 'fontawesome', color: '#e4405f' },
]

// ─── Nhóm ────────────────────────────────────────────────────────────────────

export const MODERATION_RULES_SEED: SeedGroupSpec<ModerationRuleSeed, typeof aiModerationRules.$inferInsert> = {
  name: 'moderation_rules',
  table: aiModerationRules,
  keyColumn: aiModerationRules.pattern,
  keyOf: row => row.pattern,
  sets: [{ version: 1, rows: DEFAULT_MODERATION_RULES }],
  toInsert: row => ({ category: row.category, ruleType: row.ruleType, pattern: row.pattern, action: row.action, severity: row.severity }),
  insert: async (tx, values) => { await tx.insert(aiModerationRules).values(values) },
}

export const SOCIAL_LINKS_SEED: SeedGroupSpec<SocialLinkSeed, typeof socialLinks.$inferInsert> = {
  name: 'social_links',
  table: socialLinks,
  keyColumn: socialLinks.platform,
  keyOf: row => row.platform,
  sets: [{ version: 1, rows: DEFAULT_SOCIAL_LINKS }],
  toInsert: (row, allRows) => ({
    platform: row.platform, label: row.label, url: row.url, icon: row.icon, iconType: row.iconType, color: row.color,
    sortOrder: allRows.indexOf(row), isVisible: true,
  }),
  insert: async (tx, values) => { await tx.insert(socialLinks).values(values) },
}

export const MEDIA_CATEGORIES_SEED: SeedGroupSpec<MediaCategorySeed, typeof mediaCategories.$inferInsert> = {
  name: 'media_categories',
  table: mediaCategories,
  keyColumn: mediaCategories.slug,
  keyOf: row => row.slug,
  sets: [{ version: 1, rows: DEFAULT_MEDIA_CATEGORIES }],
  toInsert: row => ({ name: row.name, slug: row.slug, description: row.description ?? null, displayOrder: row.displayOrder }),
  insert: async (tx, values) => { await tx.insert(mediaCategories).values(values) },
}

export const CONTENT_TYPES_SEED: SeedGroupSpec<ContentTypeSeed, typeof contentTypes.$inferInsert> = {
  name: 'content_types',
  table: contentTypes,
  keyColumn: contentTypes.slug,
  keyOf: row => row.slug,
  sets: [{ version: 1, rows: DEFAULT_CONTENT_TYPES }],
  toInsert: row => ({ name: row.name, slug: row.slug, icon: row.icon, displayOrder: row.displayOrder, isSystem: true }),
  insert: async (tx, values) => { await tx.insert(contentTypes).values(values) },
}

export const CATEGORIES_SEED: SeedGroupSpec<CategorySeed, typeof categories.$inferInsert> = {
  name: 'categories',
  table: categories,
  keyColumn: categories.slug,
  keyOf: row => row.slug,
  sets: [{ version: 1, rows: DEFAULT_CATEGORIES }],
  toInsert: row => ({ name: row.name, slug: row.slug, type: row.type, parentId: null, description: row.description ?? null, displayOrder: row.displayOrder }),
  insert: async (tx, values) => { await tx.insert(categories).values(values) },
}

/** Mọi spec nhóm — suite nâng cấp đọc default (qua `toInsert`) từ đây. */
export const SEED_GROUP_SPECS = [CONTENT_TYPES_SEED, CATEGORIES_SEED, MEDIA_CATEGORIES_SEED, MODERATION_RULES_SEED, SOCIAL_LINKS_SEED] as const

/** Thứ tự chạy: thể loại trước danh mục bài viết (danh mục trỏ thể loại qua `type`). */
export const SEED_GROUPS: readonly SeedGroup[] = [
  defineSeedGroup(CONTENT_TYPES_SEED),
  defineSeedGroup(CATEGORIES_SEED),
  defineSeedGroup(MEDIA_CATEGORIES_SEED),
  defineSeedGroup(MODERATION_RULES_SEED),
  defineSeedGroup(SOCIAL_LINKS_SEED),
]

export interface SeedSetOutcome {
  group: SeedGroupName
  version: number
  /** `skipped` = đã có dấu; `bootstrapped` = bảng đã có hàng, chỉ ghi dấu; `seeded` = đã chèn phần thiếu. */
  result: 'skipped' | 'bootstrapped' | 'seeded'
  inserted: number
}

function isDuplicateKey(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth += 1) {
    const code = (e as { code?: unknown }).code
    const errno = (e as { errno?: unknown }).errno
    if (code === 'ER_DUP_ENTRY' || errno === 1062) return true
  }
  return false
}

async function markerExists(db: Executor, key: string): Promise<boolean> {
  const [row] = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).limit(1)
  return Boolean(row)
}

/** Chạy mọi bộ chưa có dấu của mọi nhóm, theo thứ tự phiên bản. Idempotent. */
export async function applySeedGroups(
  db: Database,
  groups: readonly SeedGroup[] = SEED_GROUPS,
  now: Date = new Date(),
): Promise<SeedSetOutcome[]> {
  const outcomes: SeedSetOutcome[] = []
  for (const group of groups) {
    for (const { version } of [...group.sets].sort((a, b) => a.version - b.version)) {
      const key = seedMarkerKey(group.name, version)
      if (await markerExists(db, key)) {
        outcomes.push({ group: group.name, version, result: 'skipped', inserted: 0 })
        continue
      }
      try {
        const result = await db.transaction(async (tx) => {
          // Dấu TRƯỚC: bản sao chạy cùng lúc chờ trên khoá hàng này rồi nhận ER_DUP_ENTRY.
          await tx.insert(settings).values({ key, value: now.toISOString(), type: 'string', group: SEED_MARKER_SETTINGS_GROUP })
          return group.applySet(tx, version)
        })
        outcomes.push({ group: group.name, version, ...result })
      } catch (err: unknown) {
        // Một lượt seed khác vừa làm bộ này — không phải lỗi.
        if (isDuplicateKey(err) && await markerExists(db, key)) {
          outcomes.push({ group: group.name, version, result: 'skipped', inserted: 0 })
          continue
        }
        throw err
      }
    }
  }
  return outcomes
}

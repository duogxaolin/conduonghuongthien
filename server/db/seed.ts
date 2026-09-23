import { getDb } from '../utils/db'
import { passwordRejectionMessage } from '../utils/password-policy'
import { hashPassword } from '../utils/auth'
import { roles, permissions, users, homeSections, settings, chatbotSettings, chatbotSmallTalk, categories, contentTypes, pages, pageBlocks, mediaCategories, aiProviders, aiServiceConfigs, aiModelPricing, aiBudgetSettings } from '../db/schema'
import type { BlockData } from '../../app/utils/blocks/types'
import { eq, asc, sql } from 'drizzle-orm'
import { CHATBOT_SMALL_TALK_SEED } from '../data/chatbot-small-talk-seed'
import { normalizeQuestion } from '../utils/chatbot/small-talk'
import { decryptChatbotSecret } from '../utils/chatbot/crypto'
import { encryptAiSecret, type EncryptedAiSecret } from '../utils/ai/crypto'
import { DEFAULT_CHATBOT_SYSTEM_PROMPT } from '../utils/chatbot/prompt-defaults'

/**
 * `SET col = col` on duplicate key: MySQL has no "do nothing on conflict", so
 * assigning a column to itself is the idiom for it. This seed is insert-only —
 * re-running it must never overwrite a password, a permission matrix or a
 * setting an administrator has since changed.
 *
 * Written as `sql` rather than passing the column object, which drizzle types
 * as a value assignment and rejects.
 */
const keepExisting = (column: string) => sql.raw(`\`${column}\``)

const RESOURCES = [
  'news', 'role_models', 'reintegration', 'documents', 'faq', 'categories',
  'home_sections', 'pages', 'users', 'roles', 'media', 'settings', 'submissions', 'analytics',
  'chatbot_settings', 'chatbot_knowledge',
  // Reader moderation (design.md D13, reader-google-login-comments). These fall
  // through every role branch below to the all-false default on purpose: only
  // superadmin gets them at seed time, and an administrator has to grant them
  // deliberately after upgrading. Adding them to the editor or moderator branch
  // would silently hand citizens' email addresses and posting histories to
  // whoever already held one of those roles.
  'readers', 'comments',
  // Media portal (add-media-portal, design.md D15). Same reasoning, and it
  // matters more here: `livestream` controls who can put a broadcast live on a
  // ministry portal, which is not a capability anyone should acquire by having
  // been given the news editor role. Comment moderation on media reuses the
  // existing `comments` resource rather than minting a third.
  //
  // Must stay in step with VALID_RESOURCES in server/utils/permissions.ts. Two
  // lists, and a name in one but not the other is a resource that either cannot
  // be granted (rejected by the roles endpoint) or is never seeded for
  // superadmin — both silent.
  'media_portal', 'livestream', 'ai',
]

// Default categories seeded idempotently (keyed on unique slug).
// News slugs match the legacy hardcoded slugs to ease future categorization.
// System content types (Thể Loại). isSystem=true → editable but not deletable.
const DEFAULT_CONTENT_TYPES = [
  { name: 'Bản tin & Tin tức',     slug: 'news',          icon: 'fa-solid fa-newspaper',        displayOrder: 1 },
  { name: 'Tấm gương tiêu biểu',   slug: 'role_model',    icon: 'fa-solid fa-award',            displayOrder: 2 },
  { name: 'Mô hình tái hòa nhập',  slug: 'reintegration', icon: 'fa-solid fa-people-roof',      displayOrder: 3 },
  { name: 'Văn bản pháp luật',     slug: 'document',      icon: 'fa-solid fa-file-lines',       displayOrder: 4 },
  { name: 'Giải đáp pháp luật',    slug: 'faq',           icon: 'fa-solid fa-circle-question',  displayOrder: 5 },
]

// System pages backing the fixed public routes. isSystem=true → editable but
// not deletable and slug locked. Seeded idempotently on unique slug.
const DEFAULT_PAGES = [
  { slug: 'home',    title: 'Trang chủ',  seoTitle: null, seoDescription: null },
  { slug: 'about',   title: 'Giới thiệu', seoTitle: null, seoDescription: null },
  { slug: 'contact', title: 'Liên hệ',    seoTitle: null, seoDescription: null },
]

const DEFAULT_CATEGORIES = [
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
const DEFAULT_MEDIA_CATEGORIES = [
  { name: 'Video hoạt động',    slug: 'video-hoat-dong',    displayOrder: 1, description: 'Video về hoạt động nghiệp vụ, sự kiện của Cục C11 và địa phương' },
  { name: 'Video hướng dẫn',    slug: 'video-huong-dan',    displayOrder: 2, description: 'Video hướng dẫn thủ tục, quy trình tái hòa nhập cộng đồng' },
  { name: 'Phóng sự - Tư liệu', slug: 'phong-su-tu-lieu',   displayOrder: 3, description: 'Phóng sự, tư liệu về tấm gương hoàn lương và mô hình tái hòa nhập' },
  { name: 'Video tuyên truyền', slug: 'video-tuyen-truyen', displayOrder: 4, description: 'Video tuyên truyền pháp luật, phổ biến chính sách' },
]

async function seed() {
  const db = getDb()

  console.log('🌱 Seeding database...')

  // ── Roles ────────────────────────────────────────────────────────────────
  console.log('Creating roles...')
  await db.insert(roles).values([
    { name: 'superadmin', description: 'Toàn quyền hệ thống', isSystem: true },
    { name: 'editor',     description: 'Quản lý nội dung bài viết' },
    { name: 'moderator',  description: 'Xét duyệt và xem nội dung' },
    { name: 'viewer',     description: 'Chỉ xem submissions' },
  ]).onDuplicateKeyUpdate({ set: { name: keepExisting('name') } })

  const allRoles = await db.select().from(roles)
  const superadminRole = allRoles.find(r => r.name === 'superadmin')!
  const editorRole     = allRoles.find(r => r.name === 'editor')!
  const moderatorRole  = allRoles.find(r => r.name === 'moderator')!
  const viewerRole     = allRoles.find(r => r.name === 'viewer')!

  // ── Permissions ──────────────────────────────────────────────────────────
  console.log('Creating permissions...')

  // Superadmin: full quyền tất cả resource
  const superadminPerms = RESOURCES.map(resource => ({
    roleId: superadminRole.id, resource,
    canCreate: true, canRead: true, canUpdate: true, canDelete: true,
    canPublish: true, canArchive: true, canTest: true,
  }))

  // Editor: CRUD news/role_models/reintegration/documents/faq, read home_sections & submissions, no users/roles/settings
  const editorPerms = RESOURCES.map(resource => {
    const contentResources = ['news', 'role_models', 'reintegration', 'documents', 'faq', 'categories', 'pages']
    if (contentResources.includes(resource)) {
      return { roleId: editorRole.id, resource, canCreate: true, canRead: true, canUpdate: true, canDelete: false, canPublish: false, canArchive: false, canTest: false }
    }
    if (resource === 'media') {
      return { roleId: editorRole.id, resource, canCreate: true, canRead: true, canUpdate: false, canDelete: false, canPublish: false, canArchive: false, canTest: false }
    }
    if (resource === 'home_sections' || resource === 'submissions') {
      return { roleId: editorRole.id, resource, canCreate: false, canRead: true, canUpdate: false, canDelete: false, canPublish: false, canArchive: false, canTest: false }
    }
    return { roleId: editorRole.id, resource, canCreate: false, canRead: false, canUpdate: false, canDelete: false, canPublish: false, canArchive: false, canTest: false }
  })

  // Moderator: read + update status bài viết, xem submissions
  const moderatorPerms = RESOURCES.map(resource => {
    if (['news', 'role_models', 'reintegration', 'documents', 'faq'].includes(resource)) {
      return { roleId: moderatorRole.id, resource, canCreate: false, canRead: true, canUpdate: true, canDelete: false, canPublish: false, canArchive: false, canTest: false }
    }
    if (resource === 'submissions') {
      return { roleId: moderatorRole.id, resource, canCreate: false, canRead: true, canUpdate: true, canDelete: false, canPublish: false, canArchive: false, canTest: false }
    }
    return { roleId: moderatorRole.id, resource, canCreate: false, canRead: false, canUpdate: false, canDelete: false, canPublish: false, canArchive: false, canTest: false }
  })

  // Viewer: chỉ đọc submissions
  const viewerPerms = RESOURCES.map(resource => ({
    roleId: viewerRole.id, resource,
    canCreate: false,
    canRead: resource === 'submissions',
    canUpdate: false,
    canDelete: false,
    canPublish: false,
    canArchive: false,
    canTest: false,
  }))

  // Insert-only: on re-run (e.g. every container start) do NOT overwrite an
  // administrator's customized permission matrix. New (role, resource) pairs are
  // still inserted; existing rows are preserved (no-op update).
  for (const perm of [...superadminPerms, ...editorPerms, ...moderatorPerms, ...viewerPerms]) {
    await db.insert(permissions).values(perm)
      .onDuplicateKeyUpdate({ set: { roleId: keepExisting('role_id') } })
  }

  // ── SuperAdmin User ──────────────────────────────────────────────────────
  console.log('Creating superadmin user...')
  // There is no fallback any more. The old default was documented publicly and
  // sits in this repository's history, which made it the first thing anyone
  // would try against a fresh install.
  const adminPassword = String(process.env.ADMIN_PASSWORD || '')
  const adminProblem = passwordRejectionMessage(adminPassword, { username: 'admin' })
  if (adminProblem) {
    console.error('❌ ADMIN_PASSWORD chưa đạt yêu cầu:', adminProblem)
    console.error('   Đặt ADMIN_PASSWORD trong .env rồi chạy lại, ví dụ: ADMIN_PASSWORD=$(openssl rand -base64 18)')
    process.exit(1)
  }
  const passwordHash = await hashPassword(adminPassword)

  // Insert-only: NEVER reset the admin password on re-run. Overwriting it every
  // container start would revert the password to the (public) default and is a
  // critical account-takeover risk. Create the account once; leave it thereafter.
  await db.insert(users).values({
    username: 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@conduonghuongthien.com.vn',
    passwordHash,
    roleId: superadminRole.id,
    isActive: true,
  }).onDuplicateKeyUpdate({ set: { username: keepExisting('username') } })

  // ── Home Sections ────────────────────────────────────────────────────────
  console.log('Creating home sections...')
  const defaultSections = [
    { type: 'hero',           displayOrder: 1, isVisible: true, config: { title: 'Đồng hành cùng hành trình hướng thiện', subtitle: 'Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý', bgImage: '/assets/hero_banner.jpg', btnAbout: true, btnHelp: true } },
    { type: 'stats',          displayOrder: 2, isVisible: true, config: { stats: [{ value: '34', label: 'Tỉnh / Thành phố đồng hành' }, { value: '10.000+', label: 'Người hoàn lương được hỗ trợ' }, { value: '500+', label: 'Mô hình kinh tế tiêu biểu' }, { value: '24/7', label: 'Tư vấn pháp lý & Tâm lý miễn phí' }] } },
    { type: 'news',           displayOrder: 3, isVisible: true, config: { title: 'Tin nổi bật', maxItems: 5 } },
    { type: 'role_models',    displayOrder: 4, isVisible: true, config: { title: 'Tấm Gương Tiêu Biểu', subtitle: 'Nghị lực vươn lên', maxItems: 8 } },
    { type: 'quote',          displayOrder: 5, isVisible: true, config: { quote: 'Mỗi con người lầm lỡ đều xứng đáng có một cơ hội thứ hai để hướng thiện. Sự chung tay, đồng hành của gia đình và toàn xã hội chính là ánh dương thắp sáng nẻo về lương thiện.', cite: '— Đề án Tái hòa nhập cộng đồng, C11 Bộ Công an', bgImage: '/assets/hero_banner.jpg' } },
    { type: 'reintegration',  displayOrder: 6, isVisible: true, config: { title: 'Mô Hình Tái Hòa Nhập', subtitle: 'Sinh kế bền vững', maxItems: 6 } },
    { type: 'documents',      displayOrder: 7, isVisible: true, config: { title: 'Văn bản Pháp luật Mới ban hành', maxItems: 6 } },
    { type: 'support_form',   displayOrder: 8, isVisible: true, config: { title: 'Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập' } },
    { type: 'links',          displayOrder: 9, isVisible: true, config: { title: 'Liên Kết Hữu Ích' } },
  ]

  for (const section of defaultSections) {
    await db.insert(homeSections).values(section)
      .onDuplicateKeyUpdate({ set: { displayOrder: section.displayOrder } })
  }

  // ── Default Settings ─────────────────────────────────────────────────────
  console.log('Creating default settings...')
  const defaultSettings = [
    { key: 'site_name',        value: 'Con Đường Hướng Thiện',                                group: 'general' },
    { key: 'site_description', value: 'Cổng thông tin hỗ trợ tái hòa nhập cộng đồng',        group: 'general' },
    { key: 'hotline',          value: '0903.480.985',                                          group: 'contact' },
    { key: 'email',            value: 'contact@conduonghuongthien.com.vn',                     group: 'contact' },
    { key: 'address',          value: 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội',       group: 'contact' },
    { key: 'facebook_url',     value: 'https://facebook.com',                                  group: 'contact' },
    { key: 'main_logo_url',    value: '',                                                      group: 'general' },
    { key: 'logo_url',         value: '/Logo.png',                                             group: 'general' },
    { key: 'hero_banner_url',  value: '/assets/hero_banner.jpg',                              group: 'general' },
    // ⚠️ `favicon_url` CỐ Ý KHÔNG có hàng seed, và một hàng trỏ tới
    // `/favicon-32.png` đã được thử rồi bỏ vì nó gây ra một lỗi ĐO ĐƯỢC.
    //
    // `loadFaviconSetting` đã tự lùi về đúng đường dẫn đó khi hàng vắng, nên hàng
    // seed không mua thêm gì — nhưng nó làm tuyến `/favicon.ico` thấy một "icon
    // cục bộ đã cấu hình" và phục vụ **PNG** ở đường dẫn mà máy quét, đầu đọc RSS
    // và trình duyệt cũ gọi để lấy **ICO**. Đo trên máy chủ thật: `/favicon.ico`
    // trả `content-type: image/png`, 2213 byte.
    //
    // Nó còn nói sai một điều nữa: một hàng có mặt khiến `/admin/settings/general`
    // hiện ra như "đã cấu hình" trong khi cổng đang dùng bộ mặc định — nên nút "Về
    // mặc định" trông như không làm gì. Vắng mặt là cách diễn đạt đúng cho "chưa
    // cấu hình", và cũng là trạng thái mà `favicon.delete.ts` trả về.
    { key: 'media_provider',   value: 'local',                                                 group: 'media'   },
    { key: 'r2_account_id',    value: '',                                                       group: 'media'   },
    { key: 'r2_access_key',    value: '',                                                       group: 'media'   },
    { key: 'r2_secret_key',    value: '',                                                       group: 'media'   },
    { key: 'r2_bucket',        value: '',                                                       group: 'media'   },
    { key: 'r2_public_url',    value: '',                                                       group: 'media'   },
    // ── Media Portal (video upload + chuyển mã). Chín khoá, value rỗng = fallback
    // về env/default. Cán bộ lưu qua /admin/settings/media-portal mới ghi đè.
    { key: 'media_upload_enabled',             value: '', group: 'media_portal' },
    { key: 'media_upload_max_size',             value: '', group: 'media_portal' },
    { key: 'media_upload_chunk_size',           value: '', group: 'media_portal' },
    { key: 'media_disk_floor_bytes',            value: '', group: 'media_portal' },
    { key: 'media_session_inactivity_hours',    value: '', group: 'media_portal' },
    { key: 'media_processing_heartbeat_seconds', value: '', group: 'media_portal' },
    { key: 'media_processing_stale_minutes',     value: '', group: 'media_portal' },
    { key: 'media_processing_max_jobs',          value: '', group: 'media_portal' },
    { key: 'media_processing_max_attempts',      value: '', group: 'media_portal' },
    // R2 riêng cho video — 6 khoá. Rỗng = chưa cấu hình (provider mặc định 'local').
    // Secret key mã hoá AES-256-GCM, nhãn `cdkt-video-r2-secret:v1` — xem
    // `server/utils/media-r2-secret.ts`.
    { key: 'media_video_storage_provider',      value: '', group: 'media_portal' },
    { key: 'media_video_r2_account_id',          value: '', group: 'media_portal' },
    { key: 'media_video_r2_access_key',          value: '', group: 'media_portal' },
    { key: 'media_video_r2_secret_key',          value: '', group: 'media_portal' },
    { key: 'media_video_r2_bucket',             value: '', group: 'media_portal' },
    { key: 'media_video_r2_public_url',          value: '', group: 'media_portal' },
  ]

  // Insert-only: preserve administrator-edited settings (hotline, R2 credentials,
  // media_provider, …) across re-runs. Only missing keys are seeded.
  for (const s of defaultSettings) {
    await db.insert(settings).values(s)
      .onDuplicateKeyUpdate({ set: { key: keepExisting('key') } })
  }

  // ── System Content Types (Thể Loại) ───────────────────────────────────────
  console.log('Creating system content types...')
  for (const ct of DEFAULT_CONTENT_TYPES) {
    await db.insert(contentTypes).values({
      name: ct.name,
      slug: ct.slug,
      icon: ct.icon,
      displayOrder: ct.displayOrder,
      isSystem: true,
    }).onDuplicateKeyUpdate({ set: { slug: keepExisting('slug') } })
  }

  // ── Default Categories ───────────────────────────────────────────────────
  // Idempotent on unique slug; re-running never duplicates and preserves edits.
  console.log('Creating default categories...')
  for (const c of DEFAULT_CATEGORIES) {
    await db.insert(categories).values({
      name: c.name,
      slug: c.slug,
      type: c.type,
      parentId: null,
      description: c.description ?? null,
      displayOrder: c.displayOrder,
    }).onDuplicateKeyUpdate({ set: { slug: keepExisting('slug') } })
  }

  // ── Default Media Categories ─────────────────────────────────────────────
  // Danh mục riêng cho Media Portal (video), tách khỏi `categories` (bài viết).
  // Insert-only keyed trên unique slug — chạy lại không ghi đè tên/mô tả cán bộ đã sửa.
  console.log('Creating default media categories...')
  for (const c of DEFAULT_MEDIA_CATEGORIES) {
    await db.insert(mediaCategories).values({
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      displayOrder: c.displayOrder,
    }).onDuplicateKeyUpdate({ set: { slug: keepExisting('slug') } })
  }

  // ── System Pages + block migration ────────────────────────────────────────
  // Additive: home_sections / page_contents are left intact. Guarded on
  // "page has zero blocks" so re-seeding never duplicates or clobbers editor edits.
  console.log('Creating system pages...')
  for (const p of DEFAULT_PAGES) {
    await db.insert(pages).values({
      slug: p.slug,
      title: p.title,
      isSystem: true,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
    }).onDuplicateKeyUpdate({ set: { slug: keepExisting('slug') } })
  }

  const [homePage]    = await db.select().from(pages).where(eq(pages.slug, 'home')).limit(1)
  const [aboutPage]   = await db.select().from(pages).where(eq(pages.slug, 'about')).limit(1)
  const [contactPage] = await db.select().from(pages).where(eq(pages.slug, 'contact')).limit(1)

  // Migrate existing home_sections → page_blocks of the home page (once).
  if (homePage) {
    const existingHomeBlocks = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, homePage.id)).limit(1)
    if (existingHomeBlocks.length === 0) {
      console.log('Migrating home_sections → home page blocks...')
      const sections = await db.select().from(homeSections).orderBy(asc(homeSections.displayOrder), asc(homeSections.id))
      for (const s of sections) {
        await db.insert(pageBlocks).values({
          pageId: homePage.id,
          blockType: s.type,
          displayOrder: s.displayOrder,
          data: (s.config ?? {}) as BlockData,
          isVisible: s.isVisible ?? true,
        })
      }
    }
  }

  // Seed default about blocks (only when empty).
  if (aboutPage) {
    const existing = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, aboutPage.id)).limit(1)
    if (existing.length === 0) {
      console.log('Seeding default about blocks...')
      const aboutBlocks = [
        { blockType: 'heading', displayOrder: 1, data: { text: 'Giới thiệu', subtitle: 'Ban Biên tập Cổng thông tin Con Đường Hướng Thiện', variant: 'banner', bgImage: '/assets/hero_banner.jpg', align: 'center' } },
        { blockType: 'content_aside', displayOrder: 2, data: {
          title: 'Ban Biên tập',
          icon: 'fa-solid fa-building-columns',
          bodyHtml: '<h3>Mục đích hoạt động</h3><p>Trang thông tin điện tử <strong>Con Đường Hướng Thiện</strong> hoạt động dưới sự chỉ đạo của Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.</p><p>Mục tiêu tối thượng của nền tảng là cung cấp thông tin chính thống về các chính sách, nghị định của Đảng và Nhà nước liên quan đến công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng; tuyên truyền, nhân rộng các mô hình sản xuất kinh tế hiệu quả, các tấm gương điển hình tiên tiến hoàn lương lập nghiệp thành công; định hướng tư tưởng, pháp lý và kết nối hỗ trợ trực tuyến 24/7 giúp người lầm lỡ xóa bỏ tự ti, sớm ổn định cuộc sống.</p><h3>Nhiệm vụ trọng tâm</h3><ul><li><strong>Tuyên truyền &amp; Giáo dục pháp luật:</strong> Phổ biến các quy định về xóa án tích, chính sách vay vốn ưu đãi, quyền và nghĩa vụ công dân giúp người hoàn lương nâng cao hiểu biết pháp lý.</li><li><strong>Đào tạo &amp; Hướng nghiệp:</strong> Kết nối các cơ sở đào tạo nghề và các doanh nghiệp nhân văn nhằm tổ chức các lớp học nghề, tạo cơ hội việc làm công bằng cho người lầm lỡ.</li><li><strong>Tư vấn &amp; Trợ giúp trực tuyến:</strong> Xây dựng hệ thống giải đáp tự động và đường dây nóng tiếp nhận thông tin đăng ký hỗ trợ trực tiếp 24/7 trên phạm vi cả nước.</li></ul>',
          asideLabel: 'ĐƠN VỊ CHỦ QUẢN',
          asideTitle: 'Cục Cảnh sát QLTHG, TG và THAHS tại cộng đồng (C11)',
          asideSubtitle: 'Bộ Công an',
          asideNote: 'Ban Biên Tập: Đại diện Cảnh sát Thi hành án hình sự & Hỗ trợ tư pháp công an các địa phương.',
          highlightLabel: 'Hotline liên hệ trực tiếp:',
          highlightValue: '0903.480.985',
        } },
      ]
      for (const b of aboutBlocks) {
        await db.insert(pageBlocks).values({ pageId: aboutPage.id, ...b })
      }
    }
  }

  // Seed default contact blocks (only when empty).
  if (contactPage) {
    const existing = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, contactPage.id)).limit(1)
    if (existing.length === 0) {
      console.log('Seeding default contact blocks...')
      const contactBlocks = [
        { blockType: 'heading', displayOrder: 1, data: { text: 'Liên hệ & Trợ giúp', subtitle: 'Hotline 0903.480.985 — Tiếp nhận yêu cầu trợ giúp 24/7', variant: 'banner', bgImage: '/assets/hero_banner.jpg', align: 'center' } },
        { blockType: 'contact_form', displayOrder: 2, data: {
          title: 'Gửi yêu cầu trợ giúp',
          showInfo: true,
          infoTitle: 'Thông tin Ban Biên tập',
          infoRows: [
            { label: 'Đơn vị chủ quản:', value: 'Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an' },
            { label: 'Địa chỉ:', value: 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội' },
            { label: 'Hotline:', value: '0903.480.985' },
            { label: 'Email:', value: 'contact@conduonghuongthien.com.vn' },
          ],
          noteTitle: 'Cơ chế trợ giúp',
          noteText: 'Hệ thống trợ giúp tiếp nhận yêu cầu 24/7 từ người chấp hành xong án phạt tù hoặc thân nhân của họ. Sau khi tiếp nhận thông tin, Ban Biên tập sẽ tiến hành bảo mật dữ liệu cá nhân, phân loại nghiệp vụ và chuyển giao nhanh chóng đến lực lượng Công an cấp cơ sở (xã, phường, thị trấn) hoặc ban ngành liên quan tại địa bàn bạn cư trú để hỗ trợ xử lý kịp thời.',
        } },
      ]
      for (const b of contactBlocks) {
        await db.insert(pageBlocks).values({ pageId: contactPage.id, ...b })
      }
    }
  }

  // Preserve administrator configuration on reruns; only create the disabled baseline.
  await db.insert(chatbotSettings).values({ id: 1, enabled: false })
    .onDuplicateKeyUpdate({ set: { id: keepExisting('id') } })

  // ── Chatbot small-talk dataset (insert-only, keyed on normalized question) ──
  // System rows: editable and toggleable by officers, but not deletable. On
  // rerun `keepExisting` leaves any edited wording / disabled flag untouched.
  // normalizeQuestion() is the SAME normalization the matcher uses, so two rows
  // differing only in spacing/case never split into duplicates.
  console.log('Seeding chatbot small-talk dataset...')
  const smallTalkRows = CHATBOT_SMALL_TALK_SEED.map((entry, index) => ({
    category: entry.category,
    question: entry.question,
    normalizedQuestion: normalizeQuestion(entry.question),
    answer: entry.answer,
    patterns: entry.patterns,
    isEnabled: true,
    isSystem: true,
    displayOrder: index,
  }))
  for (let i = 0; i < smallTalkRows.length; i += 50) {
    await db.insert(chatbotSmallTalk).values(smallTalkRows.slice(i, i + 50))
      .onDuplicateKeyUpdate({ set: { normalizedQuestion: keepExisting('normalized_question') } })
  }

  // ── AI Panel: pricing, service configs, budget, backfill ──────────────────
  // All insert-only / idempotent: running seed twice does NOT overwrite rows
  // an administrator has since edited (pricing, prompts, budget cap).

  // 1. Model pricing — 8 default entries (spec R7.2)
  console.log('Seeding AI model pricing...')
  const defaultPricing: Array<{
    model: string; provider: string
    promptCostPerMillion: string; completionCostPerMillion: string
  }> = [
    { model: 'delify-5.5', provider: 'delify', promptCostPerMillion: '2.0000', completionCostPerMillion: '10.0000' },
  ]
  for (const p of defaultPricing) {
    await db.insert(aiModelPricing).values(p)
      .onDuplicateKeyUpdate({ set: { model: keepExisting('model') } })
  }

  // 2. Service configs — 5 default services, inactive (spec R5.2)
  console.log('Seeding AI service configs...')
  const defaultServices: Array<{
    serviceKey: string; serviceName: string; provider: string
    systemPrompt: string; temperature: string; maxTokens: number; isActive: boolean
  }> = [
    { serviceKey: 'chatbot', serviceName: 'Trợ lý Chatbot', provider: 'delify', model: 'delify-5.5', systemPrompt: DEFAULT_CHATBOT_SYSTEM_PROMPT, temperature: '0.30', maxTokens: 4096, isActive: true },
    { serviceKey: 'translation_article', serviceName: 'Dịch bài viết', provider: 'delify', model: 'delify-5.5', systemPrompt: 'Dịch văn bản sau sang ngôn ngữ mục tiêu, giữ nguyên ý nghĩa và văn phong pháp lý.', temperature: '0.20', maxTokens: 8192, isActive: false },
    { serviceKey: 'translation_ui', serviceName: 'Dịch giao diện', provider: 'delify', model: 'delify-5.5', systemPrompt: 'Dịch các chuỗi giao diện sang ngôn ngữ mục tiêu, giữ ngắn gọn phù hợp UI.', temperature: '0.10', maxTokens: 2048, isActive: false },
    { serviceKey: 'editorial_assistant', serviceName: 'Trợ lý biên tập', provider: 'delify', model: 'delify-5.5', systemPrompt: 'Bạn là trợ lý biên tập viên cho cổng thông tin điện tử. Hỗ trợ kiểm tra chính tả, đề xuất tiêu đề, và tóm tắt nội dung.', temperature: '0.40', maxTokens: 4096, isActive: false },
    { serviceKey: 'moderation', serviceName: 'Kiểm duyệt nội dung', provider: 'delify', model: 'delify-5.5', systemPrompt: 'Kiểm duyệt nội dung bài viết: phát hiện ngôn từ thù ghét, spam, hoặc nội dung không phù hợp. Phân loại: an toàn / cần xem lại / vi phạm.', temperature: '0.00', maxTokens: 2048, isActive: false },
  ]
  for (const s of defaultServices) {
    await db.insert(aiServiceConfigs).values(s)
      .onDuplicateKeyUpdate({ set: { serviceKey: keepExisting('service_key') } })
  }

  // 3. Budget settings — single row, default 0 = unlimited (spec R9.1)
  console.log('Seeding AI budget settings...')
  await db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80 })
    .onDuplicateKeyUpdate({ set: { id: keepExisting('id') } })

  // 4. Provider default rows — empty keys (spec R4.1)
  //    Insert 4 provider rows with empty keys so the admin UI has them ready.
  //    Admin activates and fills the API key via /admin/ai/providers.
  console.log('Seeding AI providers (empty keys)...')
  const defaultProviders: Array<{ provider: string; label: string; baseUrl: string | null }> = [
    { provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1' },
  ]
  for (const p of defaultProviders) {
    await db.insert(aiProviders).values({ provider: p.provider, label: p.label, baseUrl: p.baseUrl, isActive: false })
      .onDuplicateKeyUpdate({ set: { provider: keepExisting('provider') } })
  }

  // 5. Backfill from chatbot_settings (spec R11.2, R11.3)
  //    Only runs if ai_providers is empty (no provider rows with keys) AND
  //    chatbot_settings has a configured provider.
  console.log('Checking for chatbot backfill...')
  const [existingChatbotSettings] = await db.select().from(chatbotSettings).where(eq(chatbotSettings.id, 1)).limit(1)

  if (existingChatbotSettings && existingChatbotSettings.providerPolicy && existingChatbotSettings.baseUrl) {
    // Map the chatbot providerPolicy to an ai_providers.provider name
    const chatbotPolicies: Record<string, string> = {
      'openai-compatible': 'openai',
      'anthropic': 'anthropic',
    }
    const chatbotProvider = chatbotPolicies[existingChatbotSettings.providerPolicy] ?? 'openai'

    // Backfill ai_providers: set base_url and re-encrypt the API key from
    // chatbot_settings. The chatbot key is encrypted under label
    // `cdkt-chatbot-provider-key:v1` while the AI gateway decrypts under
    // `cdkt-ai-provider-key:v1` — copying ciphertext directly fails. Decrypt
    // with the chatbot label, then re-encrypt with the AI label.
    const [providerRow] = await db.select().from(aiProviders).where(eq(aiProviders.provider, chatbotProvider)).limit(1)

    if (providerRow && !providerRow.apiKeyCiphertext && existingChatbotSettings.apiKeyCiphertext) {
      console.log(`  Backfilling AI provider '${chatbotProvider}' from chatbot_settings...`)

      let aiEnvelope: EncryptedAiSecret | null = null
      try {
        const plaintextKey = decryptChatbotSecret({
          ciphertext: existingChatbotSettings.apiKeyCiphertext,
          nonce: existingChatbotSettings.apiKeyNonce!,
          authTag: existingChatbotSettings.apiKeyAuthTag!,
          version: existingChatbotSettings.apiKeyVersion!,
          keyId: existingChatbotSettings.apiKeyKeyId!,
          lastFour: existingChatbotSettings.apiKeyLastFour ?? '',
        })
        aiEnvelope = encryptAiSecret(plaintextKey)
      } catch (err) {
        console.warn(`  Could not decrypt chatbot API key for backfill — skipping key copy. Provider row created without key. (${err instanceof Error ? err.message : 'unknown error'})`)
      }

      await db.update(aiProviders).set({
        baseUrl: existingChatbotSettings.baseUrl,
        ...(aiEnvelope ? {
          apiKeyCiphertext: aiEnvelope.ciphertext,
          apiKeyNonce: aiEnvelope.nonce,
          apiKeyVersion: aiEnvelope.version,
          apiKeyKeyId: aiEnvelope.keyId,
          apiKeyAuthTag: aiEnvelope.authTag,
          apiKeyLastFour: aiEnvelope.lastFour,
        } : {}),
        isActive: Boolean(existingChatbotSettings.enabled),
      }).where(eq(aiProviders.provider, chatbotProvider))
    }

    // Backfill ai_service_configs 'chatbot' row from chatbot_settings
    const [chatbotConfig] = await db.select().from(aiServiceConfigs).where(eq(aiServiceConfigs.serviceKey, 'chatbot')).limit(1)

    if (chatbotConfig && !chatbotConfig.systemPrompt && existingChatbotSettings.systemPrompt) {
      console.log('  Backfilling AI chatbot service config from chatbot_settings...')
      await db.update(aiServiceConfigs).set({
        provider: chatbotProvider,
        model: existingChatbotSettings.model,
        systemPrompt: existingChatbotSettings.systemPrompt,
        isActive: Boolean(existingChatbotSettings.enabled),
      }).where(eq(aiServiceConfigs.serviceKey, 'chatbot'))
    }
  }

  console.log('✅ Seed complete!')
  console.log('📋 Login username: admin (mật khẩu lấy từ ADMIN_PASSWORD — không in ra log).')
  process.exit(0)
}

seed().catch(err => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})

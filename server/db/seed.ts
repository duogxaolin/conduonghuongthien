import { getDb } from '../utils/db'
import { hashPassword } from '../utils/auth'
import { roles, permissions, users, homeSections, settings, chatbotSettings, categories, contentTypes, pages, pageBlocks } from '../db/schema'
import { eq, asc } from 'drizzle-orm'

const RESOURCES = [
  'news', 'role_models', 'reintegration', 'documents', 'faq', 'categories',
  'home_sections', 'pages', 'users', 'roles', 'media', 'settings', 'submissions', 'analytics',
  'chatbot_settings', 'chatbot_knowledge'
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
  { name: 'Tin địa phương',   slug: 'tin-dia-phuong',   type: 'news',          displayOrder: 3 },
  { name: 'Tấm gương tiêu biểu', slug: 'tam-guong-tieu-bieu', type: 'role_model',   displayOrder: 1 },
  { name: 'Mô hình tái hòa nhập', slug: 'mo-hinh-tai-hoa-nhap', type: 'reintegration', displayOrder: 1 },
  { name: 'Văn bản pháp luật', slug: 'van-ban-phap-luat', type: 'document',      displayOrder: 1 },
  { name: 'Hỏi đáp pháp luật', slug: 'hoi-dap-phap-luat', type: 'faq',           displayOrder: 1 },
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
  ]).onDuplicateKeyUpdate({ set: { name: roles.name } })

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

  for (const perm of [...superadminPerms, ...editorPerms, ...moderatorPerms, ...viewerPerms]) {
    await db.insert(permissions).values(perm)
      .onDuplicateKeyUpdate({ set: { canCreate: perm.canCreate, canRead: perm.canRead, canUpdate: perm.canUpdate, canDelete: perm.canDelete, canPublish: perm.canPublish, canArchive: perm.canArchive, canTest: perm.canTest } })
  }

  // ── SuperAdmin User ──────────────────────────────────────────────────────
  console.log('Creating superadmin user...')
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456'
  const passwordHash = await hashPassword(adminPassword)

  await db.insert(users).values({
    username: 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@conduonghuongthien.com.vn',
    passwordHash,
    roleId: superadminRole.id,
    isActive: true,
  }).onDuplicateKeyUpdate({ set: { passwordHash } })

  // ── Home Sections ────────────────────────────────────────────────────────
  console.log('Creating home sections...')
  const defaultSections = [
    { type: 'hero',           displayOrder: 1, isVisible: true, config: { title: 'Đồng hành cùng hành trình hướng thiện', subtitle: 'Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý', bgImage: '/assets/hero_banner.jpg', btnAbout: true, btnHelp: true } },
    { type: 'stats',          displayOrder: 2, isVisible: true, config: { stats: [{ value: '34', label: 'Tỉnh / Thành phố đồng hành' }, { value: '10.000+', label: 'Người hoàn lương được hỗ trợ' }, { value: '500+', label: 'Mô hình kinh tế tiêu biểu' }, { value: '24/7', label: 'Tư vấn pháp lý & Tâm lý miễn phí' }] } },
    { type: 'news',           displayOrder: 3, isVisible: true, config: { title: 'Tin nổi bật', maxItems: 5 } },
    { type: 'role_models',    displayOrder: 4, isVisible: true, config: { title: 'Tấm Gương Tiêu Biểu', subtitle: 'Nghị lực vươn lên', maxItems: 3 } },
    { type: 'reintegration',  displayOrder: 5, isVisible: true, config: { title: 'Mô Hình Tái Hòa Nhập', subtitle: 'Sinh kế bền vững', maxItems: 3 } },
    { type: 'documents',      displayOrder: 6, isVisible: true, config: { title: 'Văn bản Pháp luật Mới ban hành', maxItems: 6 } },
    { type: 'support_form',   displayOrder: 7, isVisible: true, config: { title: 'Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập' } },
    { type: 'links',          displayOrder: 8, isVisible: true, config: { title: 'Liên Kết Hữu Ích' } },
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
    { key: 'logo_url',         value: '/Logo.png',                                             group: 'general' },
    { key: 'hero_banner_url',  value: '/assets/hero_banner.jpg',                              group: 'general' },
    { key: 'media_provider',   value: 'local',                                                 group: 'media'   },
    { key: 'r2_account_id',    value: '',                                                       group: 'media'   },
    { key: 'r2_access_key',    value: '',                                                       group: 'media'   },
    { key: 'r2_secret_key',    value: '',                                                       group: 'media'   },
    { key: 'r2_bucket',        value: '',                                                       group: 'media'   },
    { key: 'r2_public_url',    value: '',                                                       group: 'media'   },
  ]

  for (const s of defaultSettings) {
    await db.insert(settings).values(s)
      .onDuplicateKeyUpdate({ set: { value: s.value } })
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
    }).onDuplicateKeyUpdate({ set: { slug: contentTypes.slug } })
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
      displayOrder: c.displayOrder,
    }).onDuplicateKeyUpdate({ set: { slug: categories.slug } })
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
    }).onDuplicateKeyUpdate({ set: { slug: pages.slug } })
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
          data: (s.config ?? {}) as any,
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
        await db.insert(pageBlocks).values({ pageId: aboutPage.id, ...b } as any)
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
        await db.insert(pageBlocks).values({ pageId: contactPage.id, ...b } as any)
      }
    }
  }

  // Preserve administrator configuration on reruns; only create the disabled baseline.
  await db.insert(chatbotSettings).values({ id: 1, enabled: false })
    .onDuplicateKeyUpdate({ set: { id: chatbotSettings.id } })

  console.log('✅ Seed complete!')
  console.log(`📋 Login: username=admin  password=${adminPassword}`)
  process.exit(0)
}

seed().catch(err => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})

import { getDb } from '../utils/db'
import { hashPassword } from '../utils/auth'
import { roles, permissions, users, homeSections, settings, chatbotSettings, categories, contentTypes } from '../db/schema'

const RESOURCES = [
  'news', 'role_models', 'reintegration', 'documents', 'faq', 'categories',
  'home_sections', 'users', 'roles', 'media', 'settings', 'submissions', 'analytics',
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
    const contentResources = ['news', 'role_models', 'reintegration', 'documents', 'faq', 'categories']
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

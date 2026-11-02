/** Canonical permission catalog shared by role editing and server validation. */
export const PERMISSION_RESOURCES = [
  { key: 'news', label: 'Bản tin & Tin tức' },
  { key: 'role_models', label: 'Tấm gương tiêu biểu' },
  { key: 'reintegration', label: 'Mô hình tái hòa nhập' },
  { key: 'documents', label: 'Văn bản pháp luật' },
  { key: 'faq', label: 'Giải đáp pháp luật' },
  { key: 'categories', label: 'Danh mục' },
  { key: 'home_sections', label: 'Trang chủ' },
  { key: 'pages', label: 'Trang nội dung' },
  { key: 'users', label: 'Người dùng' },
  { key: 'roles', label: 'Vai trò & Phân quyền' },
  { key: 'media', label: 'Thư viện ảnh & tệp' },
  { key: 'settings', label: 'Cài đặt Website' },
  { key: 'submissions', label: 'Đơn đăng ký hỗ trợ' },
  { key: 'analytics', label: 'Thống kê' },
  { key: 'chatbot_settings', label: 'Cài đặt trợ lý' },
  { key: 'chatbot_knowledge', label: 'Kho kiến thức trợ lý' },
  { key: 'readers', label: 'Người đọc' },
  { key: 'comments', label: 'Bình luận' },
  { key: 'media_portal', label: 'Cổng video & âm thanh' },
  { key: 'livestream', label: 'Phát trực tiếp' },
  { key: 'ai', label: 'AI Panel' },
] as const

export const PERMISSION_ACTIONS = [
  { flag: 'canCreate', action: 'create', label: 'Thêm' },
  { flag: 'canRead', action: 'read', label: 'Xem' },
  { flag: 'canUpdate', action: 'update', label: 'Sửa' },
  { flag: 'canDelete', action: 'delete', label: 'Xóa' },
  { flag: 'canPublish', action: 'publish', label: 'Xuất bản' },
  { flag: 'canArchive', action: 'archive', label: 'Lưu trữ' },
  { flag: 'canTest', action: 'test', label: 'Kiểm thử' },
] as const

export type PermissionFlag = typeof PERMISSION_ACTIONS[number]['flag']
export type PermissionFlags = Record<PermissionFlag, boolean>
export type PermissionGrant = PermissionFlags & { resource: string }

/**
 * Retired cells of the catalog: still STORED (the `permissions` rows and the `can_test`
 * column stay, and the role editor sends them back unchanged on every save), but no handler
 * checks them, so they grant nothing.
 *
 *   - `home_sections`: its admin routes were removed (CHANGELOG § 64); the public read of the
 *     legacy home blocks needs no permission.
 *   - `canTest`: its only reader, `requireChatbotSettingsPermission(…, 'test')`, had no route
 *     left (`POST /api/admin/chatbot/test`, removed in § 64) and was removed with this list.
 *
 * Kept in `PERMISSION_RESOURCES`/`PERMISSION_ACTIONS` on purpose: those lists are what a save
 * writes back (the PUT replaces a role's rows with the payload), so taking an entry out there
 * would wipe the stored value of every role saved afterwards. Instead the role editor does not
 * SHOW them (`ROLE_MATRIX_*`) and the "no granting what you don't hold" checks skip them
 * (`isRetiredPermission`): an officer could neither see nor clear a hidden grant, so a hidden
 * grant that still counted would lock delegated managers out of a role for good (the seeded
 * `editor` holds `home_sections:read`).
 *
 * Bringing one back to life = removing it from these sets in the same change that adds the
 * handler check, AFTER deciding what to do with the values stored while it was hidden — they
 * were never compared against the actor's rights.
 */
export const RETIRED_PERMISSION_RESOURCES: ReadonlySet<string> = new Set(['home_sections'])
export const RETIRED_PERMISSION_FLAGS: ReadonlySet<PermissionFlag> = new Set<PermissionFlag>(['canTest'])

/** A cell that grants nothing: a retired resource, or a retired flag on any resource. */
export function isRetiredPermission(resource: string, flag: PermissionFlag): boolean {
  return RETIRED_PERMISSION_RESOURCES.has(resource) || RETIRED_PERMISSION_FLAGS.has(flag)
}

/** The rows and columns the role editor shows — the catalog without its retired cells. */
export const ROLE_MATRIX_RESOURCES = PERMISSION_RESOURCES.filter(({ key }) => !RETIRED_PERMISSION_RESOURCES.has(key))
export const ROLE_MATRIX_ACTIONS = PERMISSION_ACTIONS.filter(({ flag }) => !RETIRED_PERMISSION_FLAGS.has(flag))

/** Null legacy DB flags mean denied; all seven flags survive an editor roundtrip. */
export function rolePermissionMatrix(rows: Array<{ resource: string } & Partial<Record<PermissionFlag, boolean | null>>>): Record<string, PermissionFlags> {
  return Object.fromEntries(PERMISSION_RESOURCES.map(({ key }) => {
    const row = rows.find(permission => permission.resource === key)
    return [key, Object.fromEntries(PERMISSION_ACTIONS.map(({ flag }) => [flag, row?.[flag] === true])) as PermissionFlags]
  }))
}

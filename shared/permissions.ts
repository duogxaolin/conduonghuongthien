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

/** Null legacy DB flags mean denied; all seven flags survive an editor roundtrip. */
export function rolePermissionMatrix(rows: Array<{ resource: string } & Partial<Record<PermissionFlag, boolean | null>>>): Record<string, PermissionFlags> {
  return Object.fromEntries(PERMISSION_RESOURCES.map(({ key }) => {
    const row = rows.find(permission => permission.resource === key)
    return [key, Object.fromEntries(PERMISSION_ACTIONS.map(({ flag }) => [flag, row?.[flag] === true])) as PermissionFlags]
  }))
}

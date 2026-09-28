/**
 * Social links service — CRUD + sort cho popup MXH góc trái.
 *
 * Mọi ghi bọc transaction với activity_logs (design.md D6).
 */
import { createError } from 'h3'
import { eq, asc } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { socialLinks, activityLogs } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

export interface SocialLinkInput {
  platform: string
  label: string
  url: string
  icon?: string
  iconType?: 'fontawesome' | 'image' | 'svg'
  color?: string
  sortOrder?: number
  isVisible?: boolean
}

function validateIcon(icon: string, iconType: string): { icon: string; iconType: string } {
  const ic = String(icon || '').trim()
  if (!ic) {
    throw createError({ statusCode: 400, statusMessage: 'Icon bắt buộc (class FontAwesome hoặc URL ảnh/SVG).' })
  }
  if (iconType === 'fontawesome') {
    // class FA: bắt đầu bằng `fa-` (fa-solid/fa-brands/fa-regular/fa-...).
    if (!/^fa-/.test(ic)) {
      throw createError({ statusCode: 400, statusMessage: 'Icon FontAwesome phải bắt đầu bằng fa- (vd fa-brands fa-facebook-f).' })
    }
    return { icon: ic.slice(0, 255), iconType: 'fontawesome' }
  }
  if (iconType === 'image' || iconType === 'svg') {
    // URL ảnh/SVG: cho phép http(s):// (R2/external), hoặc /uploads/... nội bộ.
    if (!/^(https?:\/\/|\/uploads\/|\/assets\/)/i.test(ic)) {
      throw createError({ statusCode: 400, statusMessage: 'Đường dẫn ảnh/SVG phải là http(s)://, /uploads/ hoặc /assets/.' })
    }
    return { icon: ic.slice(0, 255), iconType }
  }
  throw createError({ statusCode: 400, statusMessage: 'Loại icon không hợp lệ (fontawesome | image | svg).' })
}

function validateInput(input: SocialLinkInput): {
  platform: string
  label: string
  url: string
  icon: string
  iconType: string
  color: string
  sortOrder: number
  isVisible: boolean
} {
  const platform = String(input.platform || '').trim()
  const label = String(input.label || '').trim()
  const url = String(input.url || '').trim()
  if (!platform) throw createError({ statusCode: 400, statusMessage: 'Nền tảng bắt buộc.' })
  if (!label) throw createError({ statusCode: 400, statusMessage: 'Nhãn hiển thị bắt buộc.' })
  if (!url) throw createError({ statusCode: 400, statusMessage: 'Đường dẫn bắt buộc.' })
  // Chấp nhận http(s)://, mailto:, tel: — không cho javascript:/data:.
  if (!/^(https?:|mailto:|tel:)/i.test(url)) {
    throw createError({ statusCode: 400, statusMessage: 'Đường dẫn phải bắt đầu bằng http(s)://, mailto: hoặc tel:.' })
  }
  const iconType = String(input.iconType || 'fontawesome').trim().toLowerCase()
  const { icon, iconType: validatedType } = validateIcon(String(input.icon || ''), iconType)
  const color = String(input.color || '#1877f2').trim() || '#1877f2'
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    throw createError({ statusCode: 400, statusMessage: 'Màu phải là mã hex hợp lệ (vd #1877f2).' })
  }
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder as number) : 0
  const isVisible = input.isVisible !== false
  return { platform, label, url, icon, iconType: validatedType, color, sortOrder, isVisible }
}

/** Danh sách hiển thị — chỉ visiable, sắp xếp theo sortOrder. */
export async function listVisibleSocialLinks(db: Database = getDb()) {
  return db
    .select({
      id: socialLinks.id,
      platform: socialLinks.platform,
      label: socialLinks.label,
      url: socialLinks.url,
      icon: socialLinks.icon,
      iconType: socialLinks.iconType,
      color: socialLinks.color,
      sortOrder: socialLinks.sortOrder,
    })
    .from(socialLinks)
    .where(eq(socialLinks.isVisible, true))
    .orderBy(asc(socialLinks.sortOrder), asc(socialLinks.id))
}

/** Danh sách quản trị — tất cả, kèm trạng thái hiện. */
export async function listAllSocialLinks(db: Database = getDb()) {
  return db
    .select({
      id: socialLinks.id,
      platform: socialLinks.platform,
      label: socialLinks.label,
      url: socialLinks.url,
      icon: socialLinks.icon,
      iconType: socialLinks.iconType,
      color: socialLinks.color,
      sortOrder: socialLinks.sortOrder,
      isVisible: socialLinks.isVisible,
      createdAt: socialLinks.createdAt,
      updatedAt: socialLinks.updatedAt,
    })
    .from(socialLinks)
    .orderBy(asc(socialLinks.sortOrder), asc(socialLinks.id))
}

export async function createSocialLink(actor: ActorLike, input: SocialLinkInput, db: Database = getDb()) {
  requireResourcePermission(actor, 'settings', 'update')
  const v = validateInput(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(socialLinks).values({
      platform: v.platform,
      label: v.label,
      url: v.url,
      icon: v.icon,
      iconType: v.iconType as 'fontawesome' | 'image' | 'svg',
      color: v.color,
      sortOrder: v.sortOrder,
      isVisible: v.isVisible,
    })
    const id = row.insertId
    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'create',
      resource: 'settings',
      resourceId: Number(id),
      meta: { operation: 'create_social_link', platform: v.platform, label: v.label },
    })
    return { id: Number(id) }
  })
}

export async function updateSocialLink(actor: ActorLike, id: number, input: Partial<SocialLinkInput>, db: Database = getDb()) {
  requireResourcePermission(actor, 'settings', 'update')
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }
  const patch: Record<string, unknown> = {}
  if (input.platform !== undefined) patch.platform = String(input.platform).trim()
  if (input.label !== undefined) patch.label = String(input.label).trim()
  if (input.url !== undefined) {
    const url = String(input.url).trim()
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      throw createError({ statusCode: 400, statusMessage: 'Đường dẫn phải bắt đầu bằng http(s)://, mailto: hoặc tel:.' })
    }
    patch.url = url
  }
  if (input.icon !== undefined || input.iconType !== undefined) {
    // Validate icon theo iconType mới (nếu có) hoặc hiện tại. Lấy iconType từ
    // `existing` bên dưới — nhưng validate ở đây để nuốt lỗi trước khi mở tx.
    // Đọc existing sớm hơn cho đủ ngữ cảnh.
    const iconVal = input.icon !== undefined ? String(input.icon).trim() : ''
    const iconTypeVal = input.iconType !== undefined
      ? String(input.iconType).trim().toLowerCase()
      : ''
    if (iconVal || iconTypeVal) {
      // Chỉ validate khi có đủ cặp — nếu chỉ đổi 1, service-side sẽ merge với existing.
      // Tạm gom vào patch; validate đầy đủ sau khi đọc existing.
      if (iconVal) patch.icon = iconVal
      if (iconTypeVal) patch.iconType = iconTypeVal
    }
  }
  if (input.color !== undefined) {
    const color = String(input.color).trim()
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
      throw createError({ statusCode: 400, statusMessage: 'Màu phải là mã hex hợp lệ.' })
    }
    patch.color = color
  }
  if (input.sortOrder !== undefined && Number.isFinite(input.sortOrder)) {
    patch.sortOrder = Math.trunc(input.sortOrder)
  }
  if (input.isVisible !== undefined) patch.isVisible = input.isVisible !== false

  if (Object.keys(patch).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Không có trường nào để cập nhật.' })
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(socialLinks).where(eq(socialLinks.id, id)).limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Link MXH không tồn tại.' })

    // Validate icon đầy đủ sau khi merge với existing (icon + iconType phải khớp).
    if (patch.icon !== undefined || patch.iconType !== undefined) {
      const mergedIcon = String(patch.icon ?? existing.icon)
      const mergedType = String(patch.iconType ?? existing.iconType)
      const v = validateIcon(mergedIcon, mergedType)
      patch.icon = v.icon
      patch.iconType = v.iconType
    }

    await tx.update(socialLinks).set(patch).where(eq(socialLinks.id, id))
    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'update',
      resource: 'settings',
      resourceId: id,
      meta: { operation: 'update_social_link', fields: Object.keys(patch) },
    })
  })
}

export async function deleteSocialLink(actor: ActorLike, id: number, db: Database = getDb()) {
  requireResourcePermission(actor, 'settings', 'update')
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(socialLinks).where(eq(socialLinks.id, id)).limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Link MXH không tồn tại.' })
    await tx.delete(socialLinks).where(eq(socialLinks.id, id))
    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'delete',
      resource: 'settings',
      resourceId: id,
      meta: { operation: 'delete_social_link', platform: existing.platform, label: existing.label },
    })
  })
}

/** Sắp xếp lại — nhận mảng id theo thứ tự mới. */
export async function reorderSocialLinks(actor: ActorLike, orderedIds: number[], db: Database = getDb()) {
  requireResourcePermission(actor, 'settings', 'update')
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách ID rỗng.' })
  }
  const ids = orderedIds.filter((id) => typeof id === 'number' && Number.isFinite(id) && id > 0)
  if (ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Không có ID hợp lệ.' })
  }
  return db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(socialLinks).set({ sortOrder: i }).where(eq(socialLinks.id, ids[i] as number))
    }
    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'update',
      resource: 'settings',
      meta: { operation: 'reorder_social_links', orderedIds: ids },
    })
  })
}

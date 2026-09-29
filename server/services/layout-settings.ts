/**
 * Service cho cấu hình layout chung của site — lưu trong `settings.layout_config` (JSON).
 * Thuần, không cần mount — tiền lệ `nav-config.ts`, `analytics-noc.ts`.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { settings, activityLogs } from '../db/schema'

export interface LayoutConfig {
  containerWidth: 'compact' | 'standard' | 'wide' | 'custom'
  containerCustom: number
  articleGrid: 'grid' | 'list'
  articleGridCols: 2 | 3 | 4
  socialDisplayMode: 'popup' | 'floating'
  socialAutoOpen: boolean
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  containerWidth: 'standard',
  containerCustom: 1240,
  articleGrid: 'grid',
  articleGridCols: 3,
  socialDisplayMode: 'popup',
  socialAutoOpen: true,
}

const CONTAINER_WIDTHS = ['compact', 'standard', 'wide', 'custom'] as const
const ARTICLE_GRIDS = ['grid', 'list'] as const
const SOCIAL_MODES = ['popup', 'floating'] as const

export function validateLayoutConfig(input: unknown): LayoutConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu cấu hình không hợp lệ.' })
  }
  const b = input as Record<string, unknown>

  const containerWidth = String(b.containerWidth ?? '')
  if (!CONTAINER_WIDTHS.includes(containerWidth as typeof CONTAINER_WIDTHS[number])) {
    throw createError({ statusCode: 400, statusMessage: 'Chiều rộng container không hợp lệ.' })
  }

  let containerCustom = Number(b.containerCustom)
  if (!Number.isFinite(containerCustom)) containerCustom = DEFAULT_LAYOUT_CONFIG.containerCustom
  if (containerCustom < 320 || containerCustom > 1920) {
    throw createError({ statusCode: 400, statusMessage: 'Chiều rộng tùy chỉnh phải từ 320 đến 1920px.' })
  }

  const articleGrid = String(b.articleGrid ?? '')
  if (!ARTICLE_GRIDS.includes(articleGrid as typeof ARTICLE_GRIDS[number])) {
    throw createError({ statusCode: 400, statusMessage: 'Chế độ grid bài viết không hợp lệ.' })
  }

  const articleGridColsNum = Number(b.articleGridCols)
  if (![2, 3, 4].includes(articleGridColsNum)) {
    throw createError({ statusCode: 400, statusMessage: 'Số cột grid phải là 2, 3 hoặc 4.' })
  }

  const socialDisplayMode = String(b.socialDisplayMode ?? '')
  if (!SOCIAL_MODES.includes(socialDisplayMode as typeof SOCIAL_MODES[number])) {
    throw createError({ statusCode: 400, statusMessage: 'Kiểu hiển thị MXH không hợp lệ.' })
  }

  const socialAutoOpen = b.socialAutoOpen
  if (typeof socialAutoOpen !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Tự mở MXH phải là boolean.' })
  }

  return {
    containerWidth: containerWidth as LayoutConfig['containerWidth'],
    containerCustom,
    articleGrid: articleGrid as LayoutConfig['articleGrid'],
    articleGridCols: articleGridColsNum as 2 | 3 | 4,
    socialDisplayMode: socialDisplayMode as 'popup' | 'floating',
    socialAutoOpen,
  }
}

export async function getLayoutConfig(): Promise<LayoutConfig> {
  try {
    const db = getDb()
    const [row] = await db.select().from(settings).where(eq(settings.key, 'layout_config'))
    if (!row || !row.value) return { ...DEFAULT_LAYOUT_CONFIG }
    return validateLayoutConfig(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_LAYOUT_CONFIG }
  }
}

/**
 * Lưu layout_config + audit trong cùng transaction.
 * `admin` truyền vào để kiểm quyền + ghi audit (không import ở đây để giữ thuần).
 */
export async function saveLayoutConfig(
  admin: { id: number; username: string },
  newConfig: LayoutConfig,
): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    const value = JSON.stringify(newConfig)
    // Upsert: settings.key là PK → MySQL `INSERT ... ON DUPLICATE KEY UPDATE`.
    await tx.insert(settings).values({
      key: 'layout_config',
      value,
      type: 'json',
      group: 'layout',
    }).onDuplicateKeyUpdate({ set: { value, type: 'json', group: 'layout' } })

    await tx.insert(activityLogs).values({
      userId: admin.id,
      action: 'update',
      resource: 'settings',
      resourceId: null,
      meta: { key: 'layout_config', after: newConfig },
    })
  })
}

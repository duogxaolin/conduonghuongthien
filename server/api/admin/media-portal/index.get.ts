/**
 * Danh sách mục media cho màn hình quản trị.
 *
 * ## Tại sao endpoint này đọc `media_items`, không phải `media`
 *
 * `server/api/admin/media/index.get.ts` đã có và phục vụ bảng `media` (Thư viện
 * ảnh cũ). Bảng `media_items` là kho video của tính năng Portal Media — hai bảng
 * khác nhau, hai nguồn dữ liệu khác nhau, hai đường API khác nhau. Trộn chúng
 * là để cán bộ thấy ảnh cũ lẫn video mới trên cùng một màn hình mà không có cách
 * nào phân biệt, và để một lược đồ đổi một bảng ảnh hưởng tới bảng kia. RBAC
 * cũng tách: `'media'` và `'media_portal'` là hai tài nguyên khác nhau ở
 * `permissions.ts:36` và `seed.ts:42`.
 *
 * ## Số trang phải qua `finitePositive`, không tự kẹp
 *
 * `Math.max(1, Number('abc'))` = `NaN` — mọi so sánh với `NaN` đều `false`, nên
 * `Math.max` trả lại `NaN`, đi vào `offset()` rồi JSON hoá thành `page: null`.
 * `?page=1e999` (Infinity) lọt y hệt và từng sinh 500 trên một endpoint cũ. Task
 * 13.5 nói rõ: `?page=abc` và `?page=1e999` phải trả 200 kèm `page` là một con số
 * thật, không `null`, không 500. `finitePositive` kiểm `Number.isFinite` TRƯỚC
 * khi kẹp, nên `NaN`/`Infinity` lùi về mặc định.
 *
 * `status` và `source` lạ sẽ bị **từ chối** (400), không lùi ngầm về mặc định:
 * một `?status=banana` mà lùi về "trả tất cả" là một URL báo nó đang lọc theo banana
 * trong khi màn hình hiển thị tất cả — cán bộ kết luận "không có bản nháp nào"
 * trong khi gốc sự thật là họ đang xem mọi trạng thái.
 */
import { defineEventHandler, getQuery, createError } from 'h3'

import { finitePositive, MAX_PAGE } from '../../../utils/query-number'
import { requireResourcePermission } from '../../../utils/permissions'
import {
  MEDIA_ITEM_STATUSES,
  MEDIA_LIST_MAX_LIMIT,
  MEDIA_SEARCH_MAX_LENGTH,
  MEDIA_SOURCES,
  listAllMediaForAdmin,
  type AdminMediaQuery,
  type MediaItemStatus,
  type MediaSource,
} from '../../../services/media-portal'

const DEFAULT_PER_PAGE = 20

const STATUS_VALUES = new Set<string>(MEDIA_ITEM_STATUSES)
const SOURCE_VALUES = new Set<string>(MEDIA_SOURCES)
const SORT_KEYS = new Set(['updatedAt', 'createdAt', 'publishedAt', 'title', 'viewCount'])
const ORDER_VALUES = new Set(['asc', 'desc'])

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'read')

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  const limit = finitePositive(query.limit, DEFAULT_PER_PAGE, MEDIA_LIST_MAX_LIMIT)
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, MEDIA_SEARCH_MAX_LENGTH) : ''

  let status: MediaItemStatus | undefined
  if (query.status !== undefined && query.status !== null && query.status !== '') {
    const value = String(query.status)
    if (!STATUS_VALUES.has(value)) {
      throw createError({ statusCode: 400, statusMessage: 'Giá trị trạng thái không hợp lệ.' })
    }
    status = value as MediaItemStatus
  }

  let source: MediaSource | undefined
  if (query.source !== undefined && query.source !== null && query.source !== '') {
    const value = String(query.source)
    if (!SOURCE_VALUES.has(value)) {
      throw createError({ statusCode: 400, statusMessage: 'Giá trị nguồn không hợp lệ.' })
    }
    source = value as MediaSource
  }

  let processingStatus: string | undefined
  if (query.processingStatus !== undefined && query.processingStatus !== null && query.processingStatus !== '') {
    processingStatus = String(query.processingStatus)
  }

  let categoryId: number | null | undefined
  if (query.categoryId !== undefined && query.categoryId !== null && query.categoryId !== '') {
    const value = Number(query.categoryId)
    if (!Number.isFinite(value) || value <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Danh mục không hợp lệ.' })
    }
    categoryId = Math.floor(value)
  }

  let sort: string | undefined
  if (query.sort !== undefined && query.sort !== null && query.sort !== '') {
    sort = String(query.sort)
    if (!SORT_KEYS.has(sort)) {
      throw createError({ statusCode: 400, statusMessage: 'Trường sắp xếp không hợp lệ.' })
    }
  }

  let order: 'asc' | 'desc' | undefined
  if (query.order !== undefined && query.order !== null && query.order !== '') {
    const value = String(query.order)
    if (!ORDER_VALUES.has(value)) {
      throw createError({ statusCode: 400, statusMessage: 'Thứ tự sắp xếp không hợp lệ.' })
    }
    order = value as 'asc' | 'desc'
  }

  const result = await listAllMediaForAdmin({
    page, limit, search,
    status, source, processingStatus, categoryId,
    sort, order,
  } satisfies AdminMediaQuery)

  return {
    ok: true,
    items: result.items,
    total: result.total,
    page:  result.page,
    limit: result.limit,
  }
})

/**
 * Danh sách media công khai.
 *
 * Ba nhánh trả về **phải phân biệt được**, và đây là điều đặc tả nói thẳng:
 * thư viện rỗng là một trạng thái **thành công**, còn một lượt truy vấn hỏng là
 * một **thất bại**. Gộp hai thứ đó vào cùng một `[]` là biến "cơ sở dữ liệu đang
 * hỏng" thành "cổng chưa đăng gì cả" — và người đọc kế tiếp sẽ đi tạo lại nội
 * dung đã có. Nên nhánh lỗi trả `ok: false`, và giao diện dựng nhánh lỗi có nút
 * thử lại **chạy lại chính lượt gọi này**.
 *
 * Không có dữ liệu nào của buổi phát trực tiếp ở đây. Trạng thái "đang phát" do
 * trình duyệt hỏi sau khi mount, đúng lý do như mọi thứ khác trên tuyến công
 * khai: tuyến này chạy `swr` ở tầng trên, nên một khối dựng phía máy chủ sẽ được
 * phát lại cho người kế tiếp trong cùng cửa sổ đệm.
 */
import { defineEventHandler, getQuery } from 'h3'

import { finitePositive, MAX_PAGE } from '../../../utils/query-number'
import { logError } from '../../../utils/logger'
import {
  MEDIA_LIST_MAX_LIMIT,
  MEDIA_SEARCH_MAX_LENGTH,
  countPublishedMediaByCategory,
  listPublishedMedia,
} from '../../../services/media-portal'

const DEFAULT_LIMIT = 12

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  const limit = finitePositive(query.limit, DEFAULT_LIMIT, MEDIA_LIST_MAX_LIMIT)
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, MEDIA_SEARCH_MAX_LENGTH) : ''
  const categorySlug = typeof query.category === 'string' ? query.category.trim() : ''

  try {
    // Hai lượt đọc độc lập, chạy cùng lúc: bộ đếm danh mục không phụ thuộc trang
    // đang xem. Nối đuôi nhau thì thời gian chờ là tổng hai lượt thay vì lượt
    // chậm hơn.
    const [pageResult, categories] = await Promise.all([
      listPublishedMedia({ page, limit, search, categorySlug }),
      countPublishedMediaByCategory(),
    ])

    return {
      ok: true,
      items: pageResult.items,
      categories,
      pagination: {
        page,
        limit,
        total: pageResult.total,
        totalPages: Math.ceil(pageResult.total / limit),
      },
    }
  } catch (error) {
    logError({
      event: 'public.media_list_failed',
      message: error instanceof Error ? error.message : String(error),
    })
    // Cùng hình dạng với nhánh thành công, khác đúng một trường: giao diện đọc
    // `ok` để chọn nhánh, không phải đi đoán từ một mảng rỗng.
    return {
      ok: false,
      items: [],
      categories: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    }
  }
})

import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { listActivePublicLanguages } from '../../services/public-site-queries'

export default defineEventHandler(async (event) => {
  try {
    const rows = await listActivePublicLanguages()

    return { ok: true, items: rows }
  } catch (error) {
    // `useI18n` bắt lỗi và lùi về danh sách ngôn ngữ mặc định — giữ nguyên như
    // trước; khác biệt là lượt hỏng nay có log và không mang mã 200.
    reportPublicReadFailure(event, 'public.languages_failed', error)
    return { ok: false, items: [] }
  }
})

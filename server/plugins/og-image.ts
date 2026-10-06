import { escapeHtml } from '../utils/escape-html'
import { loadOgImageSetting } from '../utils/og-image-setting'

/**
 * OG image injector — chèn `<meta property="og:image">` + Twitter Card vào mọi
 * trang công khai.
 *
 * Mô-phỏng `plugins/favicon.ts` (cùng `render:html` hook, cùng cache 30s qua
 * `loadOgImageSetting`). khác favicon ở ba điểm có chủ đích:
 *
 * 1. **`/admin/**` BỊ bỏ qua.** favicon được giữ trên admin vì một tab không icon
 *    là một tab khó phân biệt — còn og:image trên admin không có ai xem (URL admin
 *    không chia sẻ công khai), và để lại nó là rò rỉ cấu hình ra trang không nên.
 *
 * 2. **Cơ chế học (control):** bài viết có ảnh bìa (thumbnail) phải **thắng** ảnh
 *    mặc định. Trang `ArticleDetail.vue` gọi `useSeoMeta({ ogImage: thumbnailUrl })`,
 *    và `@unhead` dedup theo `property="og:image"` — tag plugin chèn vào `html.head`
 *    **trước** khi Vue head chèn tag của page, nên tag của page thay thế tag mặc
 *    định. Plugin chỉ là lưới an toàn cho route không gọi `useSeoMeta` (news list,
 *    about, contact, [slug] catch-all…).
 *
 * 3. **DB fail → không chèn gì.** favicon lùi về icon mặc định đi kèm mã nguồn vì
 *    "không icon" là trải nghiệm tệ; og:image vắng chỉ là "không có ảnh preview
 *    khi chia sẻ" — an toàn để trống, không cần fallback cứng.
 *
 * Never throws. Một thẻ meta không có lý do gì làm hỏng lượt dựng trang.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    const path = event?.path || ''
    // Bỏ qua API (không dựng document) và admin (không chia sẻ công khai).
    if (path === '/api' || path.startsWith('/api/') || path.startsWith('/admin/')) return

    const { ogImageUrl } = await loadOgImageSetting()
    if (!ogImageUrl) return

    const url = escapeHtml(ogImageUrl)
    html.head.push(`<meta property="og:image" content="${url}">`)
    // Kích thước chuẩn 1200×630 cho Facebook/Twitter. Admin được khuyên upload
    // tỉ lệ này qua hint trong form; nếu sai tỉ lệ, mạng xã hội tự crop — không
    // break, chỉ kém đẹp.
    html.head.push(`<meta property="og:image:width" content="1200">`)
    html.head.push(`<meta property="og:image:height" content="630">`)
    html.head.push(`<meta name="twitter:card" content="summary_large_image">`)
    html.head.push(`<meta name="twitter:image" content="${url}">`)
  })
})

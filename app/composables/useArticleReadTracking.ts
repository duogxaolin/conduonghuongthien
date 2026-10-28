import { onMounted, ref, watch, type Ref } from 'vue'
// Đường dẫn tương đối (không `~/`): tệp này cũng chạy trong test Node, nơi bộ nạp không
// biết alias của Nuxt.
import { classifySource, type ClientPageView } from '../utils/analytics-collector'

/**
 * Hai dấu vết của việc đọc một bài trên trang chi tiết (`components/ArticleDetail.vue`, tách ở
 * wave3 4.2): lượt xem (đếm ở máy chủ) và lịch sử đọc (chỉ trên thiết bị này). Gọi trong
 * `setup` của ArticleDetail.vue ở đúng chỗ hai khối này đứng trước khi tách, nên thứ tự các
 * hook (`onMounted`, `watch`) không đổi. Request lượt xem (`sendView`, một `$fetch` ép kiểu)
 * do ArticleDetail.vue truyền vào.
 */
export function useArticleReadTracking(options: {
  slug: () => string
  article: Ref<{ slug: string; title?: string } | null>
  record: (slug: string, title: string) => void
  sendView: (slug: string, body: { sourceCategory: ClientPageView['sourceCategory'] }) => Promise<unknown>
}) {
  /**
   * Ghi nhận lượt xem từ trình duyệt, không phải từ lượt dựng phía máy chủ.
   *
   * Trang chi tiết bài viết được phục vụ từ bộ nhớ đệm SWR 60 giây
   * (`nuxt.config.ts`), nên người đọc thứ hai trở đi trong một cửa sổ 60 giây
   * không chạm vào mã máy chủ nào cả. Đếm ở phía máy chủ sẽ thiếu đúng bằng phần
   * mà bộ nhớ đệm đang phát huy tác dụng — và con số thiếu đó trông vẫn hợp lý.
   *
   * Mọi lỗi đều nuốt: một bộ đếm lượt xem không có tư cách làm hỏng trang của
   * khách. Việc chống bấm F5 liên tục do máy chủ lo (cửa sổ 30 phút), không phải
   * do phía client — client-side thì xoá cache trình duyệt là thoát.
   */
  const sentSlug = ref('')

  function pingView(slug: string | null | undefined) {
    if (!slug || sentSlug.value === slug) return
    sentSlug.value = slug
    void options.sendView(slug, { sourceCategory: classifySource(document.referrer, window.location.hostname) }).catch(() => {})
  }

  onMounted(() => pingView(options.slug()))
  // Điều hướng phía client giữa hai bài viết dùng lại chính component này, nên
  // `onMounted` chỉ chạy một lần cho cả chuỗi bài đọc liên tiếp.
  watch(options.slug, slug => pingView(slug))

  /**
   * Ghi bài vừa đọc vào lịch sử đọc của **thiết bị này** (`localStorage`).
   *
   * Cố ý không có bảng nào trên máy chủ: xem `app/composables/useReadingHistory.ts`
   * để biết vì sao — một bảng "công dân nào đã đọc bài nào, lúc nào" là dữ liệu nhạy
   * cảm nhất mà dự án này chưa từng có, và nó sẽ sống lâu hơn mọi ai còn quan tâm
   * tới danh sách "bài đã đọc".
   *
   * Theo `article.value` chứ không theo slug của props: `lazy: true` nghĩa là bài về
   * **sau** mount, nên ghi lúc mount sẽ lưu một hàng không có tiêu đề — và trang cá
   * nhân sẽ liệt kê một danh sách slug thay vì một danh sách bài viết. `watch` với
   * `immediate` phủ cả hai trường hợp: lượt tải đầu (dữ liệu về sau) và điều hướng
   * phía client sang bài kế tiếp (component được dùng lại).
   *
   * Không nuốt lỗi ở đây vì không có gì để nuốt — `record` tự lo phần đó.
   */
  watch(options.article, value => {
    if (value?.slug) options.record(value.slug, value.title || '')
  }, { immediate: true })
}

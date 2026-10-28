import { nextTick, ref, type Ref } from 'vue'
// Đường dẫn tương đối (không `~/`): tệp này cũng chạy trong test Node, nơi bộ nạp không
// biết alias của Nuxt.
import { anchoredCommentId } from '../utils/comment-thread'

/** Bao lâu thì bỏ tô sáng. Đủ để mắt bắt được sau cú cuộn, đủ ngắn để không
 *  biến thành một trạng thái thường trực khiến bình luận trông như bị đánh dấu. */
const HIGHLIGHT_MS = 3000

/**
 * Địa chỉ riêng của từng bình luận trong luồng công khai (`components/ArticleComments.vue`):
 * tới được bằng liên kết `#comment-<id>` (thông báo cho người đọc, liên kết chia sẻ) và chép
 * ra được. Tách khỏi component ở wave3 4.2; `page` là trang bình luận đang xem của luồng.
 */
export function useCommentAnchor(route: { hash: string }, page: Ref<number>) {
  const highlightId = ref<number | null>(null)
  const copiedId = ref<number | null>(null)

  /**
   * Cuộn tới bình luận được trỏ tới và tô sáng nó một lúc.
   *
   * Phải chạy SAU khi luồng đã vẽ (`nextTick`), không thì phần tử chưa tồn tại và
   * lượt cuộn im lặng không làm gì. Nếu không tìm thấy id — bình luận đã bị xoá, hay
   * liên kết trỏ sang trang khác — thì **không làm gì cả**: cuộn về đầu danh sách sẽ
   * trông như đã tới đúng chỗ trong khi không phải vậy.
   */
  async function focusAnchoredComment() {
    const id = anchoredCommentId(route.hash)
    if (!id || typeof window === 'undefined') return

    await nextTick()
    const element = document.getElementById(`comment-${id}`)
    if (!element) return

    // Người bật giảm chuyển động vẫn cần tới đúng chỗ — chỉ bỏ phần cuộn mượt.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })

    highlightId.value = id
    window.setTimeout(() => {
      if (highlightId.value === id) highlightId.value = null
    }, HIGHLIGHT_MS)
  }

  /**
   * Chép địa chỉ của một bình luận.
   *
   * Dựng từ `window.location` chứ không ghép chuỗi từ slug: trang này tới được từ
   * nhiều nơi và địa chỉ thật là thứ duy nhất chắc chắn mở lại đúng nó. Giữ luôn
   * `?page=` của trang đang xem, nếu không thì liên kết tới một bình luận ở
   * trang 3 sẽ mở trang 1 và không tìm thấy gì.
   */
  async function copyLink(id: number) {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    url.hash = `comment-${id}`
    if (page.value > 1) url.searchParams.set('comments', String(page.value))
    else url.searchParams.delete('comments')

    try {
      await navigator.clipboard.writeText(url.toString())
      copiedId.value = id
      window.setTimeout(() => { if (copiedId.value === id) copiedId.value = null }, 2000)
    } catch {
      // Clipboard bị từ chối (không phải HTTPS, hoặc người dùng chặn). Ghi địa chỉ
      // vào thanh URL để vẫn còn cách chép tay, thay vì báo một lỗi không làm gì.
      window.history.replaceState(null, '', url.toString())
    }
  }

  return { highlightId, copiedId, focusAnchoredComment, copyLink }
}

import { ref, watch, onScopeDispose, type Ref } from 'vue'

/**
 * Khoảng cách tới đáy (px) mà vẫn tính là "đang ở đáy". Đủ rộng cho chiều cao
 * lẻ pixel và cho một dòng vừa xuất hiện chưa kịp cuộn qua.
 */
export const CHAT_BOTTOM_THRESHOLD_PX = 80

/** Khoảng trống phía trên câu hỏi khi khung dừng ở câu hỏi. */
const ANCHOR_MARGIN_PX = 12
/** Câu hỏi dài hơn phần này của khung thì chỉ giữ phần cuối của nó trên màn hình. */
const ANCHOR_MAX_SHARE = 0.4

/**
 * Giữ khung hội thoại đi theo câu trả lời mới nhất.
 *
 * **Bám đáy theo ý người đọc.** "Người đọc có đang ở đáy không" được trả lời
 * bằng sự kiện cuộn của chính họ, không phải đo lại sau khi nội dung đã cao lên.
 * Đo sau là cách cũ, và nó sai đúng lúc cần đúng: một ảnh bìa 200px tải xong đẩy
 * khoảng cách tới đáy vượt ngưỡng, lần đo kế tiếp kết luận "người đọc đã cuộn
 * lên", và khung ngừng đi theo giữa câu trả lời dù không ai chạm vào màn hình.
 * Nội dung cao lên không phát sự kiện `scroll`; `ResizeObserver` (cả khung cuộn
 * lẫn khối nội dung) nghe thấy nó — kể cả khi không có lần ghi dữ liệu nào: ảnh
 * tải xong, khung "Công cụ AI" hiện ra sau stream, bàn phím điện thoại mở ra.
 *
 * **Không cuộn quá câu hỏi vừa gửi.** Một câu trả lời đến một lần cả khối (câu
 * trả lời trích văn bản luật dài gấp đôi khung) mà cứ bám đáy thì người đọc rơi
 * thẳng xuống CUỐI câu trả lời và phải cuộn ngược lên để đọc từ đầu. Sau khi gửi,
 * khung đi theo câu trả lời nhưng dừng khi câu hỏi chạm mép trên: trả lời ngắn
 * vẫn thấy trọn, trả lời dài thì đọc được từ dòng đầu. Lần người đọc tự cuộn đầu
 * tiên trả lại toàn quyền cho họ.
 *
 * Lần cuộn do chính ta đặt cũng phát sự kiện `scroll` (bất đồng bộ). Nó được
 * nhận ra qua vị trí đã đặt và bỏ qua — nếu không, dừng ở câu hỏi (cách đáy hơn
 * ngưỡng) sẽ bị đọc thành "người đọc đã cuộn lên".
 */
export function useChatAutoScroll(container: Ref<HTMLElement | null>, content: Ref<HTMLElement | null>) {
  const isPinnedToBottom = ref(true)
  let anchorToLatestQuestion = false
  let programmaticTop: number | null = null
  let detach: (() => void) | null = null

  /** Vị trí cuộn đưa câu hỏi mới nhất (`data-chat-anchor`) lên mép trên khung. */
  const anchorLimit = (el: HTMLElement): number => {
    if (!anchorToLatestQuestion) return Infinity
    const questions = content.value?.querySelectorAll<HTMLElement>('[data-chat-anchor]')
    const question = questions?.[questions.length - 1]
    if (!question) return Infinity
    const rect = question.getBoundingClientRect()
    const top = el.scrollTop + rect.top - el.getBoundingClientRect().top
    const keep = el.clientHeight * ANCHOR_MAX_SHARE
    return rect.height > keep ? top + rect.height - keep : top - ANCHOR_MARGIN_PX
  }

  const scrollToTarget = () => {
    const el = container.value
    if (!el) return
    const bottom = el.scrollHeight - el.clientHeight
    const target = Math.max(0, Math.round(Math.min(bottom, anchorLimit(el))))
    programmaticTop = target
    el.scrollTop = target
  }

  const onScroll = () => {
    const el = container.value
    if (!el) return
    if (programmaticTop !== null && Math.abs(el.scrollTop - programmaticTop) <= 2) return
    // The visitor moved the view themselves: they decide from here on.
    programmaticTop = null
    anchorToLatestQuestion = false
    isPinnedToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < CHAT_BOTTOM_THRESHOLD_PX
  }

  const onResize = () => {
    if (isPinnedToBottom.value) scrollToTarget()
  }

  const attach = (el: HTMLElement | null, inner: HTMLElement | null) => {
    detach?.()
    detach = null
    if (!el) return
    el.addEventListener('scroll', onScroll, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
    observer?.observe(el)
    if (inner) observer?.observe(inner)
    detach = () => {
      el.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }

  watch([container, content], ([el, inner]) => attach(el, inner), { immediate: true, flush: 'post' })
  onScopeDispose(() => detach?.())

  /** Đi theo nội dung mới nhất (vẫn tôn trọng điểm dừng ở câu hỏi nếu đang có). */
  const pinToBottom = () => {
    isPinnedToBottom.value = true
    scrollToTarget()
  }

  /**
   * Sắp gửi câu hỏi: đi theo câu trả lời nhưng không cuộn quá câu hỏi đó. Không
   * cuộn ngay — câu hỏi mới chưa có trong DOM, cuộn lúc này sẽ dừng ở câu hỏi
   * TRƯỚC và kéo khung ngược lên một nhịp. Lần cuộn sau khi nó hiện ra lo việc đó.
   */
  const followLatestQuestion = () => {
    anchorToLatestQuestion = true
    isPinnedToBottom.value = true
  }

  /** Mở khung, đổi hội thoại: về đáy thật, không còn điểm dừng nào. */
  const releaseAnchor = () => {
    anchorToLatestQuestion = false
  }

  return { isPinnedToBottom, pinToBottom, followLatestQuestion, releaseAnchor }
}

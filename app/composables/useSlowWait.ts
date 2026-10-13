import { ref, watch, onScopeDispose, type Ref } from 'vue'

/**
 * Sau bao lâu chờ chữ đầu tiên thì nói rõ "đang chờ lâu hơn bình thường".
 * Câu trả lời thường có chữ đầu sau vài giây; 20 giây là đã chậm thấy rõ.
 */
export const SLOW_WAIT_THRESHOLD_MS = 20_000

/**
 * `true` khi `waiting` đã liên tục bật quá `SLOW_WAIT_THRESHOLD_MS`.
 *
 * Provider AI có lúc mất 40–200 giây cho một câu; người dùng nhìn "Đang suy nghĩ…"
 * không biết lần chờ này dài hơn thường. Chỉ nói cho họ biết — cuộc gọi không bị huỷ.
 * Mỗi lần `waiting` tắt rồi bật lại (câu hỏi mới) đếm lại từ đầu.
 */
export function useSlowWait(waiting: Ref<boolean>): Ref<boolean> {
  const slow = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  watch(waiting, (isWaiting) => {
    clear()
    slow.value = false
    if (isWaiting) timer = setTimeout(() => { slow.value = true }, SLOW_WAIT_THRESHOLD_MS)
  }, { immediate: true })

  onScopeDispose(clear)
  return slow
}

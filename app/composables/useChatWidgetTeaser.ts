import { onUnmounted, ref, type Ref } from 'vue'

/**
 * The teaser bubble beside the chat launcher: a rotating one-line invitation, first 2 s
 * after mount, then every 8 s, each shown for 6 s. Gone for good once the visitor
 * dismisses it or opens the chat. Its timers are this composable's; the bubble itself is
 * `components/chat-widget/ChatWidgetLauncher.vue`.
 *
 * Split out of `ChatWidget.vue` (wave3). `startTeaserCycle()` is called from the widget's
 * `onMounted`, so no timer ever starts during SSR (tests/no-server-side-timers.test.ts);
 * the timers are cleared on unmount.
 */
const CHAT_TEASER_MESSAGES = [
  'Bạn cần tìm hiểu về quyền lợi sau khi chấp hành xong án phạt tù?',
  'Tôi có thể giúp bạn tra cứu thủ tục xóa án tích miễn phí.',
  'Cần hỗ trợ tìm việc làm sau khi tái hòa nhập cộng đồng?',
  'Hỏi tôi về chính sách hỗ trợ vay vốn cho người hoàn lương nhé!',
  'Bạn muốn biết về các mô hình tái hòa nhập thành công?',
  'Tôi giúp bạn tìm hiểu quy trình đăng ký tạm trú sau mãn hạn tù.',
  'Cần tư vấn về quyền học nghề, học văn hóa miễn phí?',
]

export function useChatWidgetTeaser(isChatbotOpen: Ref<boolean>, showLauncher: Ref<boolean>) {
  const chatTeaserVisible = ref(false)
  const chatTeaserText = ref('')
  let teaserInterval: ReturnType<typeof setInterval> | null = null
  let teaserInitTimeout: ReturnType<typeof setTimeout> | null = null
  let teaserHideTimeout: ReturnType<typeof setTimeout> | null = null
  let teaserDismissed = false

  const showRandomTeaser = () => {
    if (isChatbotOpen.value || teaserDismissed) return
    chatTeaserText.value = CHAT_TEASER_MESSAGES[Math.floor(Math.random() * CHAT_TEASER_MESSAGES.length)]!
    chatTeaserVisible.value = true
    if (teaserHideTimeout) clearTimeout(teaserHideTimeout)
    teaserHideTimeout = setTimeout(() => { chatTeaserVisible.value = false }, 6000)
  }

  const stopTeaserCycle = () => {
    if (teaserInterval) { clearInterval(teaserInterval); teaserInterval = null }
    if (teaserInitTimeout) { clearTimeout(teaserInitTimeout); teaserInitTimeout = null }
    if (teaserHideTimeout) { clearTimeout(teaserHideTimeout); teaserHideTimeout = null }
  }

  /** Dismissed — or the chat was opened: either way the teaser has done its job. */
  const dismissTeaser = () => {
    chatTeaserVisible.value = false
    teaserDismissed = true
    stopTeaserCycle()
  }

  const startTeaserCycle = () => {
    if (teaserInterval || teaserInitTimeout || !showLauncher.value) return
    teaserInitTimeout = setTimeout(() => {
      teaserInitTimeout = null
      showRandomTeaser()
      teaserInterval = setInterval(showRandomTeaser, 8000)
    }, 2000)
  }

  onUnmounted(stopTeaserCycle)

  return { chatTeaserVisible, chatTeaserText, dismissTeaser, startTeaserCycle }
}

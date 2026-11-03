import { onUnmounted, ref, type Ref } from 'vue'
import { CHAT_TEASER_KEYS } from '../utils/chat-i18n'

/**
 * The teaser bubble beside the chat launcher: a rotating one-line invitation, first 2 s
 * after mount, then every 8 s, each shown for 6 s. Gone for good once the visitor
 * dismisses it or opens the chat. Its timers are this composable's; the bubble itself is
 * `components/chat-widget/ChatWidgetLauncher.vue`.
 *
 * Split out of `ChatWidget.vue` (wave3). `startTeaserCycle()` is called from the widget's
 * `onMounted`, so no timer ever starts during SSR (tests/no-server-side-timers.test.ts);
 * the timers are cleared on unmount.
 *
 * The invitation is an i18n KEY (`CHAT_TEASER_KEYS`, `utils/chat-i18n.ts`); the widget shows
 * `t(chatTeaserKey)` — the seven sentences used to be Vietnamese literals here.
 */
export function useChatWidgetTeaser(isChatbotOpen: Ref<boolean>, showLauncher: Ref<boolean>) {
  const chatTeaserVisible = ref(false)
  const chatTeaserKey = ref('')
  let teaserInterval: ReturnType<typeof setInterval> | null = null
  let teaserInitTimeout: ReturnType<typeof setTimeout> | null = null
  let teaserHideTimeout: ReturnType<typeof setTimeout> | null = null
  let teaserDismissed = false

  const showRandomTeaser = () => {
    if (isChatbotOpen.value || teaserDismissed) return
    chatTeaserKey.value = CHAT_TEASER_KEYS[Math.floor(Math.random() * CHAT_TEASER_KEYS.length)]!
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

  return { chatTeaserVisible, chatTeaserKey, dismissTeaser, startTeaserCycle }
}

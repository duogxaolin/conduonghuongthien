import { nextTick, onUnmounted, watch, type Ref } from 'vue'
import { createFocusReturn, inertOutside, trapTabTarget, visibleTabbables } from '../utils/focus-return'

/**
 * Opening and closing the public chat dialog as a modal (design D24, same helpers as
 * ConfirmModal) — split out of `ChatWidget.vue` (wave3), which owns the dialog element and
 * passes its refs in.
 *
 * Open: remember the opener (the bottom-nav button on phones, the launcher on desktop),
 * make the page behind `inert`, focus the first control that is actually shown at this
 * width. Close: release the page FIRST (focus() on an inert opener does nothing), then
 * return focus to the opener. While open, Escape and Tab are heard at window level, and
 * the page behind does not scroll (a swipe on the full-screen phone dialog must move the
 * transcript, not the page).
 *
 * The dialog element's classes carry half of this: `visibility` is in its transition only
 * when CLOSING (hidden after the fade-out). Opening must make it visible at once — during
 * a visibility transition the dialog is still `hidden` at its start, and `focus()` on a
 * hidden tree is silently ignored, so focus stayed behind the dialog on phones
 * (tests/e2e/chat-widget-focus.spec.ts; same rule as DefaultMobileDrawer.vue). The header
 * buttons avoid `transition-all` for the same reason: they would transition the
 * visibility they inherit.
 *
 * The widget's own steps run inside these, in the order they always ran: `onOpen` right
 * after the dialog is marked open (the teaser goes, failed quick questions reload),
 * `onOpened` once focus is inside (scroll to the newest message), `onClose` right after
 * it is marked closed (the conversation list folds).
 */
export function useChatWidgetDialog(options: {
  isChatbotOpen: Ref<boolean>
  chatbotDialog: Ref<HTMLElement | null>
  /** The launcher, where focus goes when nothing else opened the dialog. */
  chatToggleButton: Ref<{ focus: () => void } | null>
  onOpen: () => void
  onOpened: () => void
  onClose: () => void
}) {
  const { isChatbotOpen, chatbotDialog, chatToggleButton } = options

  const focusReturn = createFocusReturn((element) => element === document.body)
  let releaseOutside: (() => void) | null = null
  const releasePage = () => {
    releaseOutside?.()
    releaseOutside = null
  }

  /** Window-level while open: Escape from anywhere, and Tab wraps inside the dialog
   *  even when focus starts outside it. */
  const onWindowKeydown = (event: KeyboardEvent) => {
    if (!isChatbotOpen.value) return
    if (event.key === 'Escape') {
      void closeChatbot()
      return
    }
    if (event.key !== 'Tab' || !chatbotDialog.value) return
    const focusable = visibleTabbables<HTMLElement>(chatbotDialog.value)
    const target = trapTabTarget(focusable.length, focusable.indexOf(document.activeElement as HTMLElement), event.shiftKey)
    if (target === null) return
    event.preventDefault()
    focusable[target]?.focus()
  }

  const openChatbot = async () => {
    if (!isChatbotOpen.value) focusReturn.remember(document.activeElement as HTMLElement | null)
    isChatbotOpen.value = true
    options.onOpen()
    await nextTick()
    if (chatbotDialog.value) {
      if (!releaseOutside) releaseOutside = inertOutside(chatbotDialog.value)
      window.removeEventListener('keydown', onWindowKeydown)
      window.addEventListener('keydown', onWindowKeydown)
      visibleTabbables<HTMLElement>(chatbotDialog.value)[0]?.focus()
    }
    options.onOpened()
  }

  const closeChatbot = async () => {
    const active = document.activeElement
    // Only take focus back if it is still in the dialog (or nowhere): a visitor who
    // already moved on is not yanked back.
    const shouldRestore = !active || active === document.body || !!chatbotDialog.value?.contains(active)
    isChatbotOpen.value = false
    options.onClose()
    window.removeEventListener('keydown', onWindowKeydown)
    releasePage()
    await nextTick()
    // No remembered opener (opened programmatically): the launcher, where shown.
    if (!focusReturn.restore(shouldRestore) && shouldRestore) chatToggleButton.value?.focus()
  }

  const toggleChatbot = () => {
    if (isChatbotOpen.value) closeChatbot()
    else openChatbot()
  }

  // The dialog is full-screen on mobile; leaving the page scrollable behind it
  // lets a swipe move the page instead of the transcript.
  watch(isChatbotOpen, (open) => {
    if (typeof document !== 'undefined') document.body.style.overflow = open ? 'hidden' : ''
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onWindowKeydown)
    releasePage()
    if (typeof document !== 'undefined') document.body.style.overflow = ''
  })

  return { openChatbot, closeChatbot, toggleChatbot }
}

<template>
  <div v-if="clientMounted">
    <!-- Chat dialog. `visibility` transitions only when CLOSING: opening must show it
         at once, or focus() lands on a hidden tree (useChatWidgetDialog, design D24). -->
    <div
      id="public-chatbot-dialog"
      ref="chatbotDialog"
      class="fixed inset-0 w-screen h-[100dvh] bg-surface-tint flex flex-col z-[10008] overflow-hidden invisible opacity-0 pointer-events-none translate-y-[20px] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none md:inset-auto md:fixed md:right-5 md:bottom-5 md:w-[min(460px,calc(100vw-40px))] md:h-[min(680px,calc(100dvh-100px))] lg:w-[520px] lg:h-[min(760px,calc(100dvh-110px))] md:rounded-2xl md:shadow-[0_25px_60px_rgba(0,0,0,0.2)] md:border md:border-black/10 md:translate-y-3 md:scale-[0.96]"
      :class="isChatbotOpen ? '!visible !opacity-100 !pointer-events-auto !translate-y-0 md:!scale-100 transition-[opacity,transform]' : 'transition-[opacity,transform,visibility]'"
      :style="keyboardViewportStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-chatbot-title"
      :aria-hidden="!isChatbotOpen"
      :inert="!isChatbotOpen"
    >
      <!-- Header (back, history, clear, expand, close) -->
      <ChatWidgetHeader
        :is-conversation-list-open="isConversationListOpen"
        @close="closeChatbot"
        @toggle-history="isConversationListOpen = !isConversationListOpen"
        @clear="clearChatHistory"
        @expand="openFullPage"
      />

      <!-- Conversation list (collapsible drawer) -->
      <ChatWidgetConversationList
        v-if="isConversationListOpen"
        :conversations="conversations"
        :active-id="activeId"
        @create="onCreateConversation"
        @switch="onSwitchConversation"
        @delete="deleteConversation"
      />

      <!-- Messages -->
      <div ref="chatContainer" class="flex-1 min-h-0 px-4 py-5 overflow-y-auto overscroll-contain" aria-live="polite" aria-relevant="additions text">
        <!-- Khối nội dung tách khỏi khung cuộn để ResizeObserver thấy nó cao lên
             (ảnh tải xong, chi tiết công cụ hiện ra) và giữ khung bám đáy. -->
        <div ref="chatContent" class="flex flex-col gap-4">
        <ChatWidgetWelcome v-if="chatMessages.length <= 1" />

        <template v-for="(msg, index) in chatMessages" :key="msg.id || index">
          <div v-if="msg.id !== 'welcome'" class="flex gap-2.5" :class="msg.sender === 'user' ? 'justify-end' : 'justify-start'" :data-chat-anchor="msg.sender === 'user' ? '' : undefined">
            <div v-if="msg.sender === 'bot'" class="w-7 h-7 rounded-full bg-brand-900 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm" aria-hidden="true">
              <i class="fa-solid fa-robot text-white text-[0.65rem]"></i>
            </div>
            <div
              class="max-w-[80%] break-words px-4 py-3 text-[0.875rem] leading-[1.55] lg:text-[0.92rem] transition-opacity"
              :class="[
                msg.sender === 'bot'
                  ? 'bg-white text-[#1f2937] rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                  : msg.status === 'error'
                    ? 'bg-danger-bg text-[#b42318] border border-[#f0c0c0] rounded-[18px_4px_18px_18px]'
                    : 'bg-brand-900 text-white rounded-[18px_4px_18px_18px] shadow-[0_2px_8px_rgba(30,70,32,0.2)]',
                msg.status === 'pending' ? 'opacity-60' : ''
              ]"
            >
              <ChatMessageContent :text="msg.text" :is-bot="msg.sender === 'bot'" :tool-calls="msg.toolCalls" />
              <span v-if="msg.status === 'pending'" class="inline-flex items-center gap-1 mt-1 text-[0.72rem] opacity-70">
                <i class="fa-solid fa-circle-notch fa-spin text-[0.6rem]" aria-hidden="true"></i>
                Đang gửi…
              </span>
              <div v-if="msg.status === 'error' && msg.error" class="mt-1 flex items-center gap-2 text-[0.72rem]" role="alert">
                <i class="fa-solid fa-circle-exclamation text-[0.65rem]" aria-hidden="true"></i>
                {{ msg.error }}
                <button type="button" class="underline font-semibold text-brand-900 bg-transparent border-0 cursor-pointer p-0" @click="retryMessage(msg)">Thử lại</button>
              </div>
              <ChatWidgetMessageMeta v-if="msg.sender === 'bot' && !msg.isStreaming" :msg="msg" :copied-msg-id="copiedMsgId" @copy="copyMessageText(msg.text, msg.id)" />
              <ul v-if="msg.sources?.length && !msg.isStreaming" class="mt-1.5 mb-0 space-y-1 border-t border-line pt-1.5 list-none pl-0" :aria-label="t('cw_sources')">
                <li v-for="source in msg.sources" :key="source.id" class="text-[0.68rem] leading-snug text-ink-secondary">
                  <i class="fa-solid fa-link text-[0.5rem] text-accent mr-1" aria-hidden="true"></i>
                  <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-brand-900 underline underline-offset-2">{{ source.label }}</a>
                  <span v-else class="font-semibold">{{ source.label }}</span>
                  <span v-if="source.reference" class="text-[#6b7280]"> — {{ source.reference }}</span>

                  <!-- Most imported rows have a label and no URL, so this is the
                       only way to read the approved text behind the citation. -->
                  <button
                    v-if="source.entryId !== null"
                    type="button"
                    class="ml-1 inline-flex items-center gap-0.5 rounded-full border border-[#d4e4d2] bg-surface-tint px-1.5 py-px text-[0.62rem] font-semibold text-brand-900 cursor-pointer transition-colors hover:bg-brand-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    :aria-expanded="isSourceExpanded(source.entryId)"
                    @click="toggleSourceDetail(source.entryId)"
                  >
                    <i class="fa-solid fa-book-open text-[0.55rem]" aria-hidden="true"></i>
                    {{ isSourceExpanded(source.entryId) ? 'Thu gọn' : 'Xem đầy đủ' }}
                  </button>

                  <div v-if="isSourceExpanded(source.entryId)" class="mt-1 rounded-lg border border-line bg-surface px-2 py-1.5">
                    <p v-if="sourceDetailOf(source.entryId)?.status === 'loading'" class="m-0 text-[0.64rem] text-ink-muted" role="status" aria-live="polite">Đang tải nội dung đầy đủ…</p>
                    <div v-else-if="sourceDetailOf(source.entryId)?.status === 'error'" role="alert">
                      <p class="m-0 text-[0.64rem] text-[#b42318]">Không tải được nội dung đầy đủ.</p>
                      <button type="button" class="mt-1 rounded-full bg-brand-900 px-2 py-0.5 text-[0.62rem] font-bold text-white border-none cursor-pointer hover:bg-[#153317] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1" @click="retrySourceDetail(source.entryId)">Thử lại</button>
                    </div>
                    <template v-else-if="sourceDetailOf(source.entryId)?.status === 'ready'">
                      <p v-if="sourceDetailOf(source.entryId)?.question" class="m-0 mb-1 text-[0.66rem] font-bold text-brand-900">{{ sourceDetailOf(source.entryId)?.question }}</p>
                      <p class="m-0 whitespace-pre-wrap text-[0.66rem] leading-[1.55] text-[#1f2937]">{{ sourceDetailOf(source.entryId)?.answer }}</p>
                      <nuxt-link :to="`/qa-documents#qa-${source.entryId}`" class="mt-1 inline-block text-[0.6rem] font-bold text-brand-900 underline underline-offset-2">Mở trong Tài liệu Hỏi – Đáp →</nuxt-link>
                    </template>
                  </div>
                </li>
              </ul>
              <div v-if="msg.askContact && msg.lead && !msg.isStreaming" class="mt-3 border-t border-line pt-3">
                <p v-if="msg.lead.status === 'done'" class="m-0 text-[0.78rem] font-semibold text-brand-900"><i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i> Đã gửi thông tin. Cán bộ sẽ liên hệ với anh/chị trong thời gian sớm nhất. Cảm ơn ạ!</p>
                <form v-else class="flex flex-col gap-2" @submit.prevent="submitLead(msg)">
                  <p class="m-0 text-[0.75rem] font-bold text-[#1f2937]">Để lại thông tin liên hệ</p>
                  <!-- Nhãn sr-only: placeholder biến mất khi gõ và không phải tên truy cập đáng tin. -->
                  <label :for="leadFieldId(uid, msg.id || index, 'name')" class="sr-only">{{ t('cw_lead_name') }}</label>
                  <input :id="leadFieldId(uid, msg.id || index, 'name')" v-model="msg.lead.name" type="text" autocomplete="name" :placeholder="t('cw_lead_name')" class="w-full rounded-lg border border-[#d4e4d2] bg-surface px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900" />
                  <label :for="leadFieldId(uid, msg.id || index, 'phone')" class="sr-only">{{ t('cw_lead_phone') }}</label>
                  <input :id="leadFieldId(uid, msg.id || index, 'phone')" v-model="msg.lead.phone" type="tel" autocomplete="tel" :placeholder="t('cw_lead_phone')" :aria-invalid="leadContactInvalid(msg.lead) ? 'true' : undefined" :aria-describedby="msg.lead.error ? leadFieldId(uid, msg.id || index, 'error') : undefined" class="w-full rounded-lg border bg-surface px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900" :class="leadContactInvalid(msg.lead) ? 'border-[#b42318]' : 'border-[#d4e4d2]'" />
                  <label :for="leadFieldId(uid, msg.id || index, 'email')" class="sr-only">{{ t('cw_lead_email') }}</label>
                  <input :id="leadFieldId(uid, msg.id || index, 'email')" v-model="msg.lead.email" type="email" autocomplete="email" :placeholder="t('cw_lead_email')" :aria-invalid="leadContactInvalid(msg.lead) ? 'true' : undefined" :aria-describedby="msg.lead.error ? leadFieldId(uid, msg.id || index, 'error') : undefined" class="w-full rounded-lg border bg-surface px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900" :class="leadContactInvalid(msg.lead) ? 'border-[#b42318]' : 'border-[#d4e4d2]'" />
                  <label :for="leadFieldId(uid, msg.id || index, 'question')" class="sr-only">{{ t('cw_lead_question') }}</label>
                  <textarea :id="leadFieldId(uid, msg.id || index, 'question')" v-model="msg.lead.question" rows="2" :placeholder="t('cw_lead_question')" class="w-full rounded-lg border border-[#d4e4d2] bg-surface px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900"></textarea>
                  <p v-if="msg.lead.error" :id="leadFieldId(uid, msg.id || index, 'error')" class="m-0 text-[0.7rem] text-[#b42318]" role="alert">{{ msg.lead.error }}</p>
                  <button type="submit" :disabled="msg.lead.status === 'sending'" class="self-start rounded-full bg-brand-900 px-4 py-1.5 text-[0.78rem] font-bold text-white hover:bg-[#153317] disabled:opacity-50">{{ msg.lead.status === 'sending' ? 'Đang gửi...' : 'Gửi thông tin' }}</button>
                </form>
              </div>
            </div>
          </div>
          <!-- Gợi ý hỏi tiếp: chỉ dưới câu trả lời mới nhất, khi đã trả lời xong. -->
          <ChatFollowUps
            v-if="msg.sender === 'bot' && !msg.isStreaming && index === chatMessages.length - 1 && msg.followUps?.length"
            :questions="msg.followUps"
            :disabled="isSubmitting"
            class="pl-[38px]"
            @ask="askBot"
          />
        </template>

        <!-- One indicator, from send until the first word lands. The bot message
             is not in the transcript yet, so this never sits beside an empty
             bubble. -->
        <div v-if="isAwaitingFirstWord" class="flex gap-2.5 justify-start">
          <div class="w-7 h-7 rounded-full bg-brand-900 flex items-center justify-center flex-shrink-0 shadow-sm" aria-hidden="true">
            <i class="fa-solid fa-robot text-white text-[0.65rem]"></i>
          </div>
          <div class="bg-white px-3.5 py-2.5 rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-surface-tint max-w-xs" role="status" aria-live="polite">
            <span class="sr-only">Trợ lý đang soạn câu trả lời</span>
            <div class="flex items-center gap-1.5 text-[0.72rem] font-semibold text-brand-700">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-brand-700"></span>
              </span>
              <span>Đang suy nghĩ &amp; tra cứu...</span>
            </div>
            <div class="flex gap-1 items-center mt-1.5" aria-hidden="true">
              <span class="w-1.5 h-1.5 bg-brand-900 rounded-full animate-typing-dot motion-reduce:animate-none motion-reduce:opacity-60"></span>
              <span class="w-1.5 h-1.5 bg-brand-900 rounded-full animate-typing-dot [animation-delay:200ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
              <span class="w-1.5 h-1.5 bg-brand-900 rounded-full animate-typing-dot [animation-delay:400ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
            </div>
            <!-- Sau ~20 giây: nói rõ lần chờ này dài hơn thường. Nằm trong vùng role="status"
                 nên trình đọc màn hình cũng được báo; cuộc gọi không bị huỷ. -->
            <p v-if="isSlowWait" class="m-0 mt-1.5 text-[0.72rem] leading-snug text-ink-muted">Đang chờ lâu hơn bình thường, xin anh/chị chờ thêm…</p>
          </div>
        </div>
        </div>
      </div>

      <!-- Quick-question status. Loading, error and empty each say something
           different about whether to wait, so they get a visible line rather
           than an empty strip; success is announced to screen readers only,
           because the chips themselves are the visible answer. -->
      <p
        v-if="quickQuestionState !== 'success'"
        class="flex-shrink-0 m-0 border-t border-line bg-white px-4 py-2 text-[0.72rem] text-ink-muted"
        role="status"
        aria-live="polite"
      >{{ quickQuestionStatusText }}</p>
      <p v-else class="sr-only" role="status" aria-live="polite">{{ quickQuestionStatusText }}</p>

      <!-- Quick questions -->
      <ChatWidgetQuickQuestions
        v-if="quickQuestionState === 'success' && quickQuestions.length"
        :quick-questions="quickQuestions"
        :is-quick-questions-expanded="isQuickQuestionsExpanded"
        :is-submitting="isSubmitting"
        @toggle="isQuickQuestionsExpanded = !isQuickQuestionsExpanded"
        @ask="askBot"
      />

      <!-- Input (honeypot, question box, send, counter); the error line is this
           component's own alert, rendered right under the box. -->
      <ChatWidgetComposer
        ref="botInputRef"
        v-model:bot-input="botInput"
        v-model:honeypot="honeypot"
        :limits="limits"
        :bot-input-error="botInputError"
        :is-submitting="isSubmitting"
        @submit="sendBotMessage"
      >
        <template #error>
          <p id="public-chatbot-error" class="m-0 text-[0.7rem] text-[#b42318]" role="alert">{{ botInputError }}</p>
        </template>
      </ChatWidgetComposer>
    </div>

    <!-- Toggle button + teaser bubble -->
    <ChatWidgetLauncher
      v-if="showLauncher"
      ref="chatToggleButton"
      :is-chatbot-open="isChatbotOpen"
      :chat-teaser-visible="chatTeaserVisible"
      :chat-teaser-text="chatTeaserText"
      @toggle="toggleChatbot"
      @dismiss-teaser="dismissTeaser"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * The public chat widget (dialog, transcript, launcher), driven by the layout through
 * `defineExpose`. Wave3 split: display parts in `components/chat-widget/`, the modal
 * mechanics in `useChatWidgetDialog`, the teaser timers in `useChatWidgetTeaser`, the
 * clipboard in `useChatCopy`, the conversation in `useChatbot`. HERE: the dialog element,
 * the transcript with every per-message state (sending, send error + "Thử lại", a source's
 * loading / error / "Thử lại", the contact form and its error), the reply indicator, the
 * quick-question status line and the input's error line (through the input row's slot).
 */
import { ref, onMounted, nextTick, watch, useId } from 'vue'
import { leadContactInvalid, leadFieldId } from '~/utils/form-a11y'
import { useChatbot, type ChatMessage } from '~/composables/useChatbot'
import { useChatAutoScroll } from '~/composables/useChatAutoScroll'
import { useChatCopy } from '~/composables/useChatCopy'
import { useChatWidgetDialog } from '~/composables/useChatWidgetDialog'
import { useChatWidgetTeaser } from '~/composables/useChatWidgetTeaser'
import { useKeyboardViewport } from '~/composables/useKeyboardViewport'
import { useSlowWait } from '~/composables/useSlowWait'
import { useI18n } from '~/composables/useI18n'
import ChatWidgetHeader from '~/components/chat-widget/ChatWidgetHeader.vue'
import ChatWidgetConversationList from '~/components/chat-widget/ChatWidgetConversationList.vue'
import ChatWidgetQuickQuestions from '~/components/chat-widget/ChatWidgetQuickQuestions.vue'
import ChatWidgetComposer from '~/components/chat-widget/ChatWidgetComposer.vue'
import ChatWidgetLauncher from '~/components/chat-widget/ChatWidgetLauncher.vue'
import ChatWidgetMessageMeta from '~/components/chat-widget/ChatWidgetMessageMeta.vue'
import ChatWidgetWelcome from '~/components/chat-widget/ChatWidgetWelcome.vue'

const { t } = useI18n()
// Tiền tố id cho biểu mẫu để-lại-liên-hệ (lặp theo từng tin nhắn).
const uid = useId()

const {
  conversations, activeId, activeConversation, chatMessages, isSubmitting, isAwaitingFirstWord, botInput, botInputError,
  quickQuestions, quickQuestionState, quickQuestionStatusText, limits,
  hydrate, loadQuickQuestions,
  createConversation, switchConversation, deleteConversation, clearChatHistory,
  submitBotQuestion, submitLead,
  isSourceExpanded, sourceDetailOf, toggleSourceDetail, retrySourceDetail,
} = useChatbot()

// Gates every browser-only surface. The composable reads localStorage, so
// rendering during SSR would produce markup the client immediately contradicts.
const clientMounted = ref(false)
const isChatbotOpen = ref(false)
// "Waiting longer than usual" once the first word is 20s late.
const isSlowWait = useSlowWait(isAwaitingFirstWord)
// Phones: the full-screen dialog follows the visible area when the keyboard opens.
const { keyboardViewportStyle } = useKeyboardViewport(isChatbotOpen)
const isConversationListOpen = ref(false)
const isQuickQuestionsExpanded = ref(true)
/** Bound to the honeypot input. Stays empty for a real visitor. */
const honeypot = ref('')

const chatContainer = ref<HTMLElement | null>(null)
const chatContent = ref<HTMLElement | null>(null)
const { isPinnedToBottom, pinToBottom, followLatestQuestion, releaseAnchor } = useChatAutoScroll(chatContainer, chatContent)
const chatbotDialog = ref<HTMLElement | null>(null)
// The input row and the launcher are parts; each exposes `focus()` for its control.
const botInputRef = ref<{ focus: () => void } | null>(null)
const chatToggleButton = ref<{ focus: () => void } | null>(null)

/**
 * The launcher is hidden on /assistant: that page *is* the chat, so a floating
 * button offering to open a smaller copy of it is noise.
 */
const route = useRoute()
const showLauncher = computed(() => route.path !== '/assistant')

const { copiedMsgId, copyMessageText } = useChatCopy()
// ─── Teaser bubble. Its timers stop on unmount BEFORE the dialog releases the page
// (each composable's own onUnmounted, in creation order — as the one hook did).
const { chatTeaserVisible, chatTeaserText, dismissTeaser, startTeaserCycle } = useChatWidgetTeaser(isChatbotOpen, showLauncher)

// ─── Following the newest content ────────────────────────────────────────────
/**
 * Follows the newest content. During playback this runs every frame, and yanking
 * the view down while someone is scrolled up re-reading an earlier answer fights
 * them for control of the scrollbar — so by default it only follows when they are
 * still pinned to the bottom. "Pinned" comes from their own scrolling
 * (`useChatAutoScroll`), not from measuring after the content grew: a cover image
 * finishing its load used to read as "the visitor scrolled up" and stop the
 * follow mid-answer.
 *
 * `force` is for opening the panel, switching conversation and first mount, where
 * the container starts at `scrollTop = 0` and the bottom is the intended landing
 * spot rather than somewhere the visitor chose to be.
 */
const scrollChatBottom = async (force = false) => {
  await nextTick()
  const el = chatContainer.value
  if (!el) return
  const wasAtBottom = force || isPinnedToBottom.value
  if (wasAtBottom) pinToBottom()
}
/** Playback passes this as `onTick`, which would otherwise forward its own args. */
const followChatBottom = () => { void scrollChatBottom() }

// Tự động cuộn xuống dưới khi có tin nhắn mới hoặc bot bắt đầu suy nghĩ/trả lời
watch(() => activeConversation.value?.messages.length, () => {
  void scrollChatBottom(true)
})
watch(isSubmitting, (submitting) => {
  if (submitting) void scrollChatBottom(true)
})

// ─── Open / close: a modal (focus, inert, Escape/Tab, page scroll) ───────────
// The mechanics are useChatWidgetDialog (design D24); the widget's own steps run
// inside them, in their old order.
const { openChatbot, closeChatbot, toggleChatbot } = useChatWidgetDialog({
  isChatbotOpen, chatbotDialog, chatToggleButton,
  onOpen: () => {
    dismissTeaser()
    if (quickQuestionState.value === 'error' || quickQuestionState.value === 'empty') loadQuickQuestions()
  },
  onOpened: () => {
    releaseAnchor()
    scrollChatBottom(true)
  },
  onClose: () => { isConversationListOpen.value = false },
})

// Exposed so the layout's bottom nav and Escape handler can drive the widget
// without owning any of its state.
defineExpose({ openChatbot, closeChatbot, toggleChatbot, isChatbotOpen })

// Same close path as every other exit, so the page is released and focus goes
// back before the route changes.
const openFullPage = async () => {
  await closeChatbot()
  navigateTo('/assistant')
}

// ─── Conversations ───────────────────────────────────────────────────────────
const onCreateConversation = () => {
  createConversation()
  isConversationListOpen.value = false
  nextTick(() => botInputRef.value?.focus())
}

const onSwitchConversation = (id: string) => {
  switchConversation(id)
  isConversationListOpen.value = false
  releaseAnchor()
  scrollChatBottom(true)
}

// ─── Sending ─────────────────────────────────────────────────────────────────
const sendBotMessage = () => {
  // A filled honeypot means a script drove this form. Dropping it here saves a
  // round-trip; the server checks again because a client-side check protects
  // nothing on its own.
  if (honeypot.value.trim() !== '') return
  followLatestQuestion()
  void scrollChatBottom(true)
  // Chỉ focus lại ô nhập trên máy có chuột; trên điện thoại focus() làm bàn phím ảo bật lên lại sau mỗi câu trả lời.
  submitBotQuestion(botInput.value, followChatBottom).then(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) nextTick(() => botInputRef.value?.focus())
  })
}

const askBot = (question: string) => {
  if (isSubmitting.value) return
  botInput.value = question
  followLatestQuestion()
  void scrollChatBottom(true)
  submitBotQuestion(question, followChatBottom)
}

/** Retry a failed user message by putting the text back in the input and re-submitting. */
function retryMessage(msg: ChatMessage) {
  if (isSubmitting.value) return
  // Remove the failed message — a new one will be pushed optimistically
  const conv = activeConversation.value
  const idx = conv.messages.findIndex((m: ChatMessage) => m.id === msg.id)
  if (idx !== -1) conv.messages.splice(idx, 1)
  followLatestQuestion()
  submitBotQuestion(msg.text, followChatBottom)
}

onMounted(() => {
  clientMounted.value = true
  hydrate()
  loadQuickQuestions()
  startTeaserCycle()
})
</script>

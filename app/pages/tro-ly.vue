<template>
  <div class="bg-[#f0f4ef]">
    <div class="mx-auto max-w-[1400px] px-0 md:px-4 md:py-6">
      <div class="md:grid md:grid-cols-[280px_1fr] md:gap-4">
        <!-- Sidebar: hidden below md. The two-column layout has no room to be
             useful on a phone, and the floating widget already serves that case. -->
        <aside class="hidden md:flex md:flex-col md:h-[calc(100dvh-160px)] rounded-2xl border border-[#e1e8e0] bg-white overflow-hidden">
          <div class="flex-shrink-0 border-b border-[#e1e8e0] p-3">
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1e4620] px-3 py-2.5 text-[0.85rem] font-bold text-white border-none cursor-pointer transition-all hover:bg-[#153317] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
              @click="onCreateConversation"
            >
              <i class="fa-solid fa-plus text-[0.75rem]" aria-hidden="true"></i>
              Cuộc trò chuyện mới
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto overscroll-contain p-2" aria-label="Danh sách cuộc trò chuyện">
            <p v-if="!conversations.length" class="m-0 px-2 py-3 text-[0.78rem] text-[#9ca3af]">Chưa có cuộc trò chuyện nào.</p>
            <ul class="list-none m-0 p-0 space-y-1">
              <li v-for="conversation in sortedConversations" :key="conversation.id">
                <div
                  class="group flex items-center gap-1 rounded-xl px-2 py-2 transition-colors"
                  :class="conversation.id === activeId ? 'bg-[#e4f0e2]' : 'hover:bg-[#f6f8f6]'"
                >
                  <button
                    type="button"
                    class="flex-1 min-w-0 bg-transparent border-none text-left cursor-pointer p-0"
                    :aria-current="conversation.id === activeId ? 'true' : undefined"
                    @click="onSwitchConversation(conversation.id)"
                  >
                    <span class="block truncate text-[0.82rem] font-semibold" :class="conversation.id === activeId ? 'text-[#1e4620]' : 'text-[#374151]'">
                      {{ conversation.title }}
                    </span>
                    <span class="block text-[0.68rem] text-[#9ca3af]">{{ conversationMeta(conversation) }}</span>
                  </button>
                  <button
                    type="button"
                    class="w-7 h-7 flex-shrink-0 rounded-lg bg-transparent border-none text-[#9ca3af] cursor-pointer transition-colors hover:bg-[#fee2e2] hover:text-[#b42318] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b42318]"
                    @click="deleteConversation(conversation.id)"
                    :aria-label="`Xóa cuộc trò chuyện ${conversation.title}`"
                  >
                    <i class="fa-solid fa-trash-can text-[0.7rem]" aria-hidden="true"></i>
                  </button>
                </div>
              </li>
            </ul>
          </nav>

          <div class="flex-shrink-0 border-t border-[#e1e8e0] px-3 py-2.5">
            <p class="m-0 text-[0.68rem] leading-snug text-[#6b7280]">
              Tối đa {{ limits.maxConversations }} cuộc trò chuyện được lưu trên thiết bị này.
            </p>
          </div>
        </aside>

        <!-- Main chat column -->
        <section class="flex flex-col h-[calc(100dvh-136px)] md:h-[calc(100dvh-160px)] md:rounded-2xl md:border md:border-[#e1e8e0] bg-white overflow-hidden">
          <!-- Header -->
          <header class="flex-shrink-0 flex items-center justify-between gap-3 border-b border-[#e1e8e0] bg-[#1e4620] px-4 py-3">
            <div class="flex min-w-0 items-center gap-3">
              <div class="w-10 h-10 flex-shrink-0 rounded-full bg-white/15 border-2 border-white/30 flex items-center justify-center">
                <i class="fa-solid fa-robot text-white text-[1.05rem]" aria-hidden="true"></i>
              </div>
              <div class="min-w-0">
                <h1 class="m-0 truncate text-[1rem] font-bold leading-tight text-white">Trợ lý Hướng Thiện</h1>
                <p class="mt-0.5 mb-0 truncate text-[0.72rem] text-white/65">{{ activeConversation.title }}</p>
              </div>
            </div>
            <div class="flex flex-shrink-0 items-center gap-1.5">
              <!-- Mobile-only: the sidebar is hidden here, so this is the only
                   way to start a new conversation on a phone. -->
              <button type="button" class="md:hidden w-9 h-9 rounded-full bg-white/10 border-none text-white/85 flex items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90" @click="onCreateConversation" aria-label="Cuộc trò chuyện mới">
                <i class="fa-solid fa-plus text-[0.8rem]" aria-hidden="true"></i>
              </button>
              <button type="button" class="w-9 h-9 rounded-full bg-white/10 border-none text-white/85 flex items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90" @click="clearChatHistory" title="Xóa nội dung cuộc trò chuyện" aria-label="Xóa nội dung cuộc trò chuyện">
                <i class="fa-solid fa-broom text-[0.8rem]" aria-hidden="true"></i>
              </button>
              <NuxtLink to="/" class="w-9 h-9 rounded-full bg-white/10 text-white/85 flex items-center justify-center no-underline transition-all hover:bg-white/20" title="Về trang chủ" aria-label="Về trang chủ">
                <i class="fa-solid fa-house text-[0.8rem]" aria-hidden="true"></i>
              </NuxtLink>
            </div>
          </header>

          <!-- Transcript -->
          <div ref="chatContainer" class="flex-1 overflow-y-auto overscroll-contain bg-[#f8faf8] px-4 py-6 md:px-8" aria-live="polite" aria-relevant="additions text">
            <div class="mx-auto flex max-w-[760px] flex-col gap-5">
              <div v-if="chatMessages.length <= 1" class="mx-auto mt-6 max-w-[420px] text-center">
                <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#1e4620]/10">
                  <i class="fa-solid fa-shield-halved text-[1.6rem] text-[#1e4620]" aria-hidden="true"></i>
                </div>
                <p class="m-0 text-[0.95rem] leading-relaxed text-[#4A5545]">
                  Xin chào! Tôi hỗ trợ tra cứu thông tin từ kho dữ liệu đã được
                  <strong class="text-[#1e4620]">Cục C11</strong> phê duyệt.
                </p>
                <p
                  v-if="quickQuestionState !== 'success'"
                  class="m-0 mt-5 text-[0.8rem] text-[#667768]"
                  role="status"
                  aria-live="polite"
                >{{ quickQuestionStatusText }}</p>
                <div v-if="quickQuestionState === 'success' && quickQuestions.length" class="mt-5 flex flex-wrap justify-center gap-2">
                  <button
                    v-for="question in quickQuestions"
                    :key="question.id"
                    type="button"
                    :disabled="isSubmitting"
                    class="cursor-pointer rounded-full border border-[#d4e4d2] bg-white px-3.5 py-1.5 text-[0.78rem] font-medium text-[#2d4a2d] transition-all hover:border-[#1e4620] hover:bg-[#1e4620] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    @click="askBot(question.question)"
                  >{{ question.question }}</button>
                </div>
              </div>

              <template v-for="(msg, index) in chatMessages" :key="msg.id || index">
                <div v-if="msg.id !== 'welcome'" class="flex gap-3" :class="msg.sender === 'user' ? 'justify-end' : 'justify-start'">
                  <div v-if="msg.sender === 'bot'" class="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#1e4620] shadow-sm" aria-hidden="true">
                    <i class="fa-solid fa-robot text-[0.7rem] text-white"></i>
                  </div>
                  <div
                    class="max-w-[85%] break-words px-4 py-3 text-[0.92rem] leading-[1.6] md:max-w-[75%]"
                    :class="msg.sender === 'bot'
                      ? 'bg-white text-[#1f2937] rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                      : 'bg-[#1e4620] text-white rounded-[18px_4px_18px_18px] shadow-[0_2px_8px_rgba(30,70,32,0.2)]'"
                  >
                    <p class="m-0 whitespace-pre-wrap">{{ msg.text }}</p>
                    <p v-if="msg.kind && msg.sender === 'bot' && !msg.isStreaming" class="mt-2 mb-0 flex items-center gap-1 text-[0.72rem] font-semibold" :class="messageKindClass(msg.kind)" role="status">
                      <i class="fa-solid" :class="isProblemKind(msg.kind) ? 'fa-circle-exclamation text-[#9a3412]' : 'fa-circle-check text-[#1e4620]'" aria-hidden="true"></i>
                      {{ messageKindLabel(msg.kind) }}
                    </p>
                    <ul v-if="msg.sources?.length && !msg.isStreaming" class="mt-2 mb-0 list-none space-y-2 border-t border-[#e1e8e0] pl-0 pt-2" aria-label="Nguồn tham khảo">
                      <li v-for="source in msg.sources" :key="source.id" class="text-[0.74rem] leading-snug text-[#4A5545]">
                        <i class="fa-solid fa-link mr-1 text-[0.58rem] text-[#7CB342]" aria-hidden="true"></i>
                        <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#1e4620] underline underline-offset-2">{{ source.label }}</a>
                        <span v-else class="font-semibold">{{ source.label }}</span>
                        <span v-if="source.reference" class="text-[#6b7280]"> — {{ source.reference }}</span>

                        <!-- Most imported rows have a label and no URL, so this is
                             the only way to read the text behind the citation. -->
                        <button
                          v-if="source.entryId !== null"
                          type="button"
                          class="mt-1 flex cursor-pointer items-center gap-1 rounded-full border border-[#d4e4d2] bg-[#f0f6ef] px-2.5 py-0.5 text-[0.72rem] font-semibold text-[#1e4620] transition-colors hover:bg-[#1e4620] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                          :aria-expanded="isSourceExpanded(source.entryId)"
                          @click="toggleSourceDetail(source.entryId)"
                        >
                          <i class="fa-solid fa-book-open text-[0.62rem]" aria-hidden="true"></i>
                          {{ isSourceExpanded(source.entryId) ? 'Thu gọn' : 'Xem đầy đủ' }}
                        </button>

                        <div v-if="isSourceExpanded(source.entryId)" class="mt-2 rounded-xl border border-[#e1e8e0] bg-[#f8faf8] px-3 py-2.5">
                          <p v-if="sourceDetailOf(source.entryId)?.status === 'loading'" class="m-0 text-[0.72rem] text-[#667768]" role="status" aria-live="polite">Đang tải nội dung đầy đủ…</p>
                          <div v-else-if="sourceDetailOf(source.entryId)?.status === 'error'" role="alert">
                            <p class="m-0 text-[0.72rem] text-[#b42318]">Không tải được nội dung đầy đủ.</p>
                            <button type="button" class="mt-1.5 cursor-pointer rounded-full border-none bg-[#1e4620] px-3 py-1 text-[0.7rem] font-bold text-white hover:bg-[#153317] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]" @click="retrySourceDetail(source.entryId)">Thử lại</button>
                          </div>
                          <template v-else-if="sourceDetailOf(source.entryId)?.status === 'ready'">
                            <p v-if="sourceDetailOf(source.entryId)?.question" class="m-0 mb-1.5 text-[0.76rem] font-bold text-[#1e4620]">{{ sourceDetailOf(source.entryId)?.question }}</p>
                            <p class="m-0 whitespace-pre-wrap text-[0.76rem] leading-[1.65] text-[#1f2937]">{{ sourceDetailOf(source.entryId)?.answer }}</p>
                          </template>
                        </div>
                      </li>
                    </ul>
                    <div v-if="msg.askContact && msg.lead && !msg.isStreaming" class="mt-3 border-t border-[#e1e8e0] pt-3">
                      <p v-if="msg.lead.status === 'done'" class="m-0 text-[0.82rem] font-semibold text-[#1e4620]">
                        <i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>
                        Đã gửi thông tin. Cán bộ sẽ liên hệ với anh/chị trong thời gian sớm nhất. Cảm ơn ạ!
                      </p>
                      <form v-else class="flex flex-col gap-2" @submit.prevent="submitLead(msg)">
                        <p class="m-0 text-[0.8rem] font-bold text-[#1f2937]">Để lại thông tin liên hệ</p>
                        <input v-model="msg.lead.name" type="text" placeholder="Họ và tên" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.84rem] outline-none focus:border-[#1e4620]" />
                        <input v-model="msg.lead.phone" type="tel" placeholder="Số điện thoại" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.84rem] outline-none focus:border-[#1e4620]" />
                        <input v-model="msg.lead.email" type="email" placeholder="Email (nếu có)" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.84rem] outline-none focus:border-[#1e4620]" />
                        <textarea v-model="msg.lead.question" rows="2" placeholder="Nội dung cần hỗ trợ" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.84rem] outline-none focus:border-[#1e4620]"></textarea>
                        <p v-if="msg.lead.error" class="m-0 text-[0.74rem] text-[#b42318]" role="alert">{{ msg.lead.error }}</p>
                        <button type="submit" :disabled="msg.lead.status === 'sending'" class="self-start rounded-full bg-[#1e4620] px-4 py-1.5 text-[0.82rem] font-bold text-white hover:bg-[#153317] disabled:opacity-50">
                          {{ msg.lead.status === 'sending' ? 'Đang gửi...' : 'Gửi thông tin' }}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </template>

              <!-- One indicator, from send until the first word lands. The bot
                   message is not in the transcript yet, so this never sits beside
                   an empty bubble. -->
              <div v-if="isSubmitting" class="flex justify-start gap-3">
                <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#1e4620] shadow-sm" aria-hidden="true">
                  <i class="fa-solid fa-robot text-[0.7rem] text-white"></i>
                </div>
                <div class="rounded-[4px_18px_18px_18px] bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]" role="status" aria-live="polite">
                  <span class="sr-only">Trợ lý đang soạn câu trả lời</span>
                  <div class="flex items-center gap-1" aria-hidden="true">
                    <span class="h-1.5 w-1.5 animate-typing-dot rounded-full bg-[#1e4620] motion-reduce:animate-none motion-reduce:opacity-60"></span>
                    <span class="h-1.5 w-1.5 animate-typing-dot rounded-full bg-[#1e4620] [animation-delay:200ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
                    <span class="h-1.5 w-1.5 animate-typing-dot rounded-full bg-[#1e4620] [animation-delay:400ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Input bar: pinned to the bottom of the column so a long transcript
               never scrolls it out of reach. -->
          <div class="flex-shrink-0 border-t border-[#e1e8e0] bg-white px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] md:px-8 md:pb-4">
            <form class="mx-auto flex max-w-[760px] items-end gap-2" @submit.prevent="sendBotMessage">
              <input v-model="honeypot" type="text" name="_h" tabindex="-1" autocomplete="off" aria-hidden="true" class="absolute left-[-9999px] h-px w-px opacity-0 pointer-events-none" />
              <div class="min-w-0 flex-1">
                <label for="tro-ly-input" class="sr-only">Nhập câu hỏi cho trợ lý</label>
                <textarea
                  id="tro-ly-input"
                  ref="botInputRef"
                  v-model="botInput"
                  rows="1"
                  placeholder="Hỏi tôi bất cứ điều gì..."
                  :maxlength="limits.maxMessageChars"
                  :aria-describedby="botInputError ? 'tro-ly-error tro-ly-counter' : 'tro-ly-counter'"
                  :aria-invalid="Boolean(botInputError)"
                  :disabled="isSubmitting"
                  class="max-h-[160px] w-full resize-none rounded-2xl border border-[#d4e4d2] bg-[#f8faf8] px-4 py-3 text-[0.92rem] leading-relaxed outline-none transition-all focus:border-[#1e4620] focus:bg-white focus:shadow-[0_0_0_3px_rgba(30,70,32,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                  @keydown.enter.exact.prevent="sendBotMessage"
                  @input="autoGrow"
                ></textarea>
                <p v-if="botInputError" id="tro-ly-error" class="m-0 mt-1 px-1 text-[0.74rem] text-[#b42318]" role="alert">{{ botInputError }}</p>
              </div>
              <button
                type="submit"
                :disabled="isSubmitting || !botInput.trim()"
                class="flex h-12 w-12 flex-shrink-0 cursor-pointer items-center justify-center rounded-2xl border-none bg-[#1e4620] text-white transition-all hover:bg-[#153317] hover:shadow-[0_4px_12px_rgba(30,70,32,0.3)] active:scale-90 disabled:cursor-not-allowed disabled:bg-[#a0b89e] disabled:opacity-40"
                aria-label="Gửi tin nhắn"
              >
                <i class="fa-solid fa-paper-plane text-[0.9rem]" aria-hidden="true"></i>
              </button>
            </form>
            <p id="tro-ly-counter" class="mx-auto mt-1 mb-0 max-w-[760px] px-1 text-right text-[0.68rem] text-[#9ca3af]" :class="{ '!text-[#b42318]': botInput.length > limits.maxMessageChars * 0.9 }">
              {{ botInput.length }}/{{ limits.maxMessageChars }}
            </p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useChatbot, type StoredConversation } from '~/composables/useChatbot'

const {
  conversations, activeId, activeConversation, chatMessages,
  isSubmitting, botInput, botInputError,
  quickQuestions, quickQuestionState, quickQuestionStatusText, limits,
  hydrate, loadQuickQuestions,
  createConversation, switchConversation, deleteConversation, clearChatHistory,
  submitBotQuestion, submitLead,
  isSourceExpanded, sourceDetailOf, toggleSourceDetail, retrySourceDetail,
  isProblemKind, messageKindLabel, messageKindClass,
} = useChatbot()

useHead({
  title: 'Trợ lý Hướng Thiện',
  meta: [{
    name: 'description',
    content: 'Trợ lý ảo hỗ trợ tra cứu thông tin về tái hòa nhập cộng đồng từ kho dữ liệu đã được Cục C11 phê duyệt.',
  }],
})

const chatContainer = ref<HTMLElement | null>(null)
const botInputRef = ref<HTMLTextAreaElement | null>(null)
/** Bound to the honeypot input. Stays empty for a real visitor. */
const honeypot = ref('')

/** Newest first, so the conversation just created is at the top of the list. */
const sortedConversations = computed(() => [...conversations.value].sort((a, b) => b.createdAt - a.createdAt))

/**
 * Follows the newest content. During playback this runs every frame, and yanking
 * the view down while someone is scrolled up re-reading an earlier answer fights
 * them for control of the scrollbar — so by default it only follows when they are
 * already at the bottom. The 48px tolerance covers sub-pixel heights and the
 * moment a new line exists but has not been scrolled past.
 *
 * `force` is for switching conversation and first mount, where the container
 * starts at `scrollTop = 0` and the bottom is the intended landing spot rather
 * than somewhere the visitor chose to be.
 */
const scrollChatBottom = async (force = false) => {
  const el = chatContainer.value
  if (!el) return
  const wasAtBottom = force || el.scrollHeight - el.scrollTop - el.clientHeight < 48
  await nextTick()
  if (wasAtBottom && chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}
/** Playback passes this as `onTick`, which would otherwise forward its own args. */
const followChatBottom = () => { void scrollChatBottom() }

const conversationMeta = (conversation: StoredConversation) => {
  const count = conversation.messages.filter(item => item.id !== 'welcome').length
  const when = new Date(conversation.createdAt)
  const stamp = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('vi-VN')
  return count ? `${count} tin nhắn · ${stamp}` : `Chưa có tin nhắn · ${stamp}`
}

const onCreateConversation = () => {
  createConversation()
  nextTick(() => botInputRef.value?.focus())
}

const onSwitchConversation = (id: string) => {
  switchConversation(id)
  scrollChatBottom(true)
}

// The textarea grows with its content up to the CSS max-height, so a long
// question is visible while being typed instead of scrolling inside one line.
const autoGrow = () => {
  const element = botInputRef.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`
}

const resetInputHeight = () => {
  if (botInputRef.value) botInputRef.value.style.height = 'auto'
}

const sendBotMessage = () => {
  if (honeypot.value.trim() !== '') return
  submitBotQuestion(botInput.value, followChatBottom).then(() => {
    resetInputHeight()
    nextTick(() => botInputRef.value?.focus())
  })
}

const askBot = (question: string) => {
  if (isSubmitting.value) return
  botInput.value = question
  submitBotQuestion(question, followChatBottom)
}

onMounted(() => {
  hydrate()
  loadQuickQuestions()
  scrollChatBottom(true)
})
</script>

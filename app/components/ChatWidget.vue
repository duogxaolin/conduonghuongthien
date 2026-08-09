<template>
  <div v-if="clientMounted">
    <!-- Chat dialog -->
    <div
      id="public-chatbot-dialog"
      ref="chatbotDialog"
      class="fixed inset-0 w-screen h-[100dvh] bg-[#f0f4ef] flex flex-col z-[10002] overflow-hidden opacity-0 pointer-events-none translate-y-[20px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none md:inset-auto md:fixed md:right-5 md:bottom-5 md:w-[min(460px,calc(100vw-40px))] md:h-[min(680px,calc(100dvh-100px))] lg:w-[520px] lg:h-[min(760px,calc(100dvh-110px))] md:rounded-2xl md:shadow-[0_25px_60px_rgba(0,0,0,0.2)] md:border md:border-black/10 md:translate-y-3 md:scale-[0.96]"
      :class="{ '!opacity-100 !pointer-events-auto !translate-y-0 md:!scale-100': isChatbotOpen }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-chatbot-title"
      :aria-hidden="!isChatbotOpen"
      :inert="!isChatbotOpen"
      @keydown="handleChatbotDialogKeydown"
    >
      <!-- Header -->
      <div class="flex-shrink-0 bg-[#1e4620] px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3 md:pt-3 md:rounded-t-2xl">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button class="md:hidden w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/90 text-[0.9rem] border-none cursor-pointer transition-all active:scale-90" @click="closeChatbot" aria-label="Quay lại">
              <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="w-10 h-10 rounded-full bg-white/15 border-2 border-white/30 flex items-center justify-center flex-shrink-0">
              <i class="fa-solid fa-robot text-white text-[1.1rem]"></i>
            </div>
            <div>
              <h4 id="public-chatbot-title" class="text-[0.95rem] font-bold text-white m-0 leading-tight">Trợ lý Hướng Thiện</h4>
              <p class="text-[0.7rem] text-white/60 mt-0.5 mb-0 flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-[#7CB342] inline-block animate-pulse" aria-hidden="true"></span>
                Đang hoạt động
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              class="w-8 h-8 rounded-full bg-white/10 border-none text-white/80 flex items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90"
              @click="isConversationListOpen = !isConversationListOpen"
              :aria-expanded="isConversationListOpen"
              title="Danh sách cuộc trò chuyện"
              aria-label="Danh sách cuộc trò chuyện"
            >
              <i class="fa-solid fa-clock-rotate-left text-[0.8rem]"></i>
            </button>
            <button class="w-8 h-8 rounded-full bg-white/10 border-none text-white/80 flex items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90" @click="clearChatHistory" title="Xóa lịch sử" aria-label="Xóa lịch sử">
              <i class="fa-solid fa-broom text-[0.8rem]"></i>
            </button>
            <!-- Expand: desktop/iPad only. The full page is a two-column layout
                 that has no room to be useful on a phone. -->
            <button class="hidden md:flex w-8 h-8 rounded-full bg-white/10 border-none text-white/80 items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90" @click="openFullPage" title="Mở rộng toàn trang" aria-label="Mở rộng toàn trang">
              <i class="fa-solid fa-up-right-and-down-left-from-center text-[0.75rem]"></i>
            </button>
            <button ref="chatCloseButton" class="hidden md:flex w-8 h-8 rounded-full bg-white/10 border-none text-white/80 items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" @click="closeChatbot" aria-label="Đóng">
              <i class="fa-solid fa-xmark text-[0.9rem]"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Conversation list (collapsible drawer) -->
      <div v-if="isConversationListOpen" class="flex-shrink-0 border-b border-[#e1e8e0] bg-white max-h-[40%] overflow-y-auto overscroll-contain">
        <div class="flex items-center justify-between px-3 py-2 border-b border-[#f0f4ef]">
          <span class="text-[0.72rem] font-bold uppercase tracking-wide text-[#6b7280]">Cuộc trò chuyện</span>
          <button type="button" class="flex items-center gap-1 rounded-full bg-[#1e4620] px-2.5 py-1 text-[0.7rem] font-bold text-white border-none cursor-pointer hover:bg-[#153317]" @click="onCreateConversation">
            <i class="fa-solid fa-plus text-[0.6rem]" aria-hidden="true"></i> Tạo mới
          </button>
        </div>
        <ul class="list-none m-0 p-0">
          <li v-for="conversation in conversations" :key="conversation.id" class="border-b border-[#f6f8f6] last:border-b-0">
            <div class="flex items-center gap-1 px-2 py-1.5" :class="{ 'bg-[#f0f6ef]': conversation.id === activeId }">
              <button
                type="button"
                class="flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer px-1 py-0.5"
                :aria-current="conversation.id === activeId ? 'true' : undefined"
                @click="onSwitchConversation(conversation.id)"
              >
                <span class="block truncate text-[0.78rem] font-semibold" :class="conversation.id === activeId ? 'text-[#1e4620]' : 'text-[#374151]'">{{ conversation.title }}</span>
                <span class="block text-[0.65rem] text-[#9ca3af]">{{ conversationMeta(conversation) }}</span>
              </button>
              <button type="button" class="w-6 h-6 flex-shrink-0 rounded-full bg-transparent border-none text-[#9ca3af] cursor-pointer hover:bg-[#fee2e2] hover:text-[#b42318]" @click="deleteConversation(conversation.id)" :aria-label="`Xóa ${conversation.title}`">
                <i class="fa-solid fa-trash-can text-[0.65rem]"></i>
              </button>
            </div>
          </li>
        </ul>
      </div>

      <!-- Messages -->
      <div ref="chatContainer" class="flex-1 px-4 py-5 overflow-y-auto overscroll-contain flex flex-col gap-4" aria-live="polite" aria-relevant="additions text">
        <div v-if="chatMessages.length <= 1" class="mx-auto mt-4 mb-2 max-w-[280px] text-center">
          <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-[#1e4620]/10 flex items-center justify-center">
            <i class="fa-solid fa-shield-halved text-[#1e4620] text-[1.4rem]"></i>
          </div>
          <p class="text-[0.82rem] text-[#4A5545] leading-relaxed m-0">Xin chào! Tôi hỗ trợ tra cứu thông tin từ kho dữ liệu đã được <strong class="text-[#1e4620]">Cục C11</strong> phê duyệt.</p>
        </div>

        <template v-for="(msg, index) in chatMessages" :key="msg.id || index">
          <div v-if="msg.id !== 'welcome'" class="flex gap-2.5" :class="msg.sender === 'user' ? 'justify-end' : 'justify-start'">
            <div v-if="msg.sender === 'bot'" class="w-7 h-7 rounded-full bg-[#1e4620] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm" aria-hidden="true">
              <i class="fa-solid fa-robot text-white text-[0.65rem]"></i>
            </div>
            <div
              class="max-w-[80%] break-words px-4 py-3 text-[0.875rem] leading-[1.55] lg:text-[0.92rem]"
              :class="msg.sender === 'bot'
                ? 'bg-white text-[#1f2937] rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                : 'bg-[#1e4620] text-white rounded-[18px_4px_18px_18px] shadow-[0_2px_8px_rgba(30,70,32,0.2)]'"
            >
              <p class="m-0 whitespace-pre-wrap">{{ msg.text }}</p>
              <p v-if="msg.kind && msg.sender === 'bot' && !msg.isStreaming" class="mt-2 mb-0 text-[0.7rem] font-semibold flex items-center gap-1" :class="messageKindClass(msg.kind)" role="status">
                <i class="fa-solid" :class="isProblemKind(msg.kind) ? 'fa-circle-exclamation text-[#9a3412]' : 'fa-circle-check text-[#1e4620]'" aria-hidden="true"></i>
                {{ messageKindLabel(msg.kind) }}
              </p>
              <ul v-if="msg.sources?.length && !msg.isStreaming" class="mt-2 mb-0 space-y-1.5 border-t border-[#e1e8e0] pt-2 list-none pl-0" aria-label="Nguồn tham khảo">
                <li v-for="source in msg.sources" :key="source.id" class="text-[0.7rem] leading-snug text-[#4A5545]">
                  <i class="fa-solid fa-link text-[0.55rem] text-[#7CB342] mr-1" aria-hidden="true"></i>
                  <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#1e4620] underline underline-offset-2">{{ source.label }}</a>
                  <span v-else class="font-semibold">{{ source.label }}</span>
                  <span v-if="source.reference" class="text-[#6b7280]"> — {{ source.reference }}</span>

                  <!-- Most imported rows have a label and no URL, so this is the
                       only way to read the approved text behind the citation. -->
                  <button
                    v-if="source.entryId !== null"
                    type="button"
                    class="mt-1 flex items-center gap-1 rounded-full border border-[#d4e4d2] bg-[#f0f6ef] px-2 py-0.5 text-[0.68rem] font-semibold text-[#1e4620] cursor-pointer transition-colors hover:bg-[#1e4620] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                    :aria-expanded="isSourceExpanded(source.entryId)"
                    @click="toggleSourceDetail(source.entryId)"
                  >
                    <i class="fa-solid fa-book-open text-[0.6rem]" aria-hidden="true"></i>
                    {{ isSourceExpanded(source.entryId) ? 'Thu gọn' : 'Xem đầy đủ' }}
                  </button>

                  <div v-if="isSourceExpanded(source.entryId)" class="mt-1.5 rounded-lg border border-[#e1e8e0] bg-[#f8faf8] px-2.5 py-2">
                    <p v-if="sourceDetailOf(source.entryId)?.status === 'loading'" class="m-0 text-[0.68rem] text-[#667768]" role="status" aria-live="polite">Đang tải nội dung đầy đủ…</p>
                    <div v-else-if="sourceDetailOf(source.entryId)?.status === 'error'" role="alert">
                      <p class="m-0 text-[0.68rem] text-[#b42318]">Không tải được nội dung đầy đủ.</p>
                      <button type="button" class="mt-1 rounded-full bg-[#1e4620] px-2.5 py-0.5 text-[0.66rem] font-bold text-white border-none cursor-pointer hover:bg-[#153317] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]" @click="retrySourceDetail(source.entryId)">Thử lại</button>
                    </div>
                    <template v-else-if="sourceDetailOf(source.entryId)?.status === 'ready'">
                      <p v-if="sourceDetailOf(source.entryId)?.question" class="m-0 mb-1 text-[0.7rem] font-bold text-[#1e4620]">{{ sourceDetailOf(source.entryId)?.question }}</p>
                      <p class="m-0 whitespace-pre-wrap text-[0.7rem] leading-[1.6] text-[#1f2937]">{{ sourceDetailOf(source.entryId)?.answer }}</p>
                      <!-- Expanding in place keeps the visitor in their conversation;
                           this is the way out to the surrounding topic, and it is a
                           link rather than a second panel because the full document
                           page is a different question from "what did you just cite". -->
                      <nuxt-link :to="`/qa-documents#qa-${source.entryId}`" class="mt-1.5 inline-block text-[0.66rem] font-bold text-[#1e4620] underline underline-offset-2">Mở trong Tài liệu Hỏi – Đáp →</nuxt-link>
                    </template>
                  </div>
                </li>
              </ul>
              <div v-if="msg.askContact && msg.lead && !msg.isStreaming" class="mt-3 border-t border-[#e1e8e0] pt-3">
                <p v-if="msg.lead.status === 'done'" class="m-0 text-[0.78rem] font-semibold text-[#1e4620]"><i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i> Đã gửi thông tin. Cán bộ sẽ liên hệ với anh/chị trong thời gian sớm nhất. Cảm ơn ạ!</p>
                <form v-else class="flex flex-col gap-2" @submit.prevent="submitLead(msg)">
                  <p class="m-0 text-[0.75rem] font-bold text-[#1f2937]">Để lại thông tin liên hệ</p>
                  <input v-model="msg.lead.name" type="text" placeholder="Họ và tên" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.8rem] outline-none focus:border-[#1e4620]" />
                  <input v-model="msg.lead.phone" type="tel" placeholder="Số điện thoại" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.8rem] outline-none focus:border-[#1e4620]" />
                  <input v-model="msg.lead.email" type="email" placeholder="Email (nếu có)" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.8rem] outline-none focus:border-[#1e4620]" />
                  <textarea v-model="msg.lead.question" rows="2" placeholder="Nội dung cần hỗ trợ" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-[0.8rem] outline-none focus:border-[#1e4620]"></textarea>
                  <p v-if="msg.lead.error" class="m-0 text-[0.7rem] text-[#b42318]" role="alert">{{ msg.lead.error }}</p>
                  <button type="submit" :disabled="msg.lead.status === 'sending'" class="self-start rounded-full bg-[#1e4620] px-4 py-1.5 text-[0.78rem] font-bold text-white hover:bg-[#153317] disabled:opacity-50">{{ msg.lead.status === 'sending' ? 'Đang gửi...' : 'Gửi thông tin' }}</button>
                </form>
              </div>
            </div>
          </div>
        </template>

        <!-- One indicator, from send until the first word lands. The bot message
             is not in the transcript yet, so this never sits beside an empty
             bubble. -->
        <div v-if="isSubmitting" class="flex gap-2.5 justify-start">
          <div class="w-7 h-7 rounded-full bg-[#1e4620] flex items-center justify-center flex-shrink-0 shadow-sm" aria-hidden="true">
            <i class="fa-solid fa-robot text-white text-[0.65rem]"></i>
          </div>
          <div class="bg-white px-3.5 py-3 rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]" role="status" aria-live="polite">
            <span class="sr-only">Trợ lý đang soạn câu trả lời</span>
            <div class="flex gap-1 items-center" aria-hidden="true">
              <span class="w-1.5 h-1.5 bg-[#1e4620] rounded-full animate-typing-dot motion-reduce:animate-none motion-reduce:opacity-60"></span>
              <span class="w-1.5 h-1.5 bg-[#1e4620] rounded-full animate-typing-dot [animation-delay:200ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
              <span class="w-1.5 h-1.5 bg-[#1e4620] rounded-full animate-typing-dot [animation-delay:400ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
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
        class="flex-shrink-0 m-0 border-t border-[#e1e8e0] bg-white px-4 py-2 text-[0.72rem] text-[#667768]"
        role="status"
        aria-live="polite"
      >{{ quickQuestionStatusText }}</p>
      <p v-else class="sr-only" role="status" aria-live="polite">{{ quickQuestionStatusText }}</p>

      <!-- Quick questions -->
      <div v-if="quickQuestionState === 'success' && quickQuestions.length" class="flex-shrink-0 border-t border-[#e1e8e0]">
        <button type="button" class="w-full px-4 py-2 bg-white text-[0.75rem] font-semibold text-[#4A5545] flex items-center justify-between border-none cursor-pointer transition-all hover:bg-[#f8faf8]" @click="isQuickQuestionsExpanded = !isQuickQuestionsExpanded">
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-lightbulb text-[#7CB342] text-[0.7rem]" aria-hidden="true"></i> Câu hỏi gợi ý</span>
          <i class="fa-solid fa-chevron-up text-[0.6rem] transition-transform duration-200" :class="{ 'rotate-180': !isQuickQuestionsExpanded }" aria-hidden="true"></i>
        </button>
        <div v-show="isQuickQuestionsExpanded" class="px-3.5 pb-2.5 bg-white">
          <div class="flex flex-wrap gap-1.5 max-h-[68px] overflow-y-auto overscroll-contain lg:max-h-[96px]">
            <button
              v-for="question in quickQuestions"
              :key="question.id"
              type="button"
              :disabled="isSubmitting"
              @click="askBot(question.question)"
              class="bg-[#f0f6ef] border border-[#d4e4d2] text-[#2d4a2d] px-2.5 py-1 rounded-full text-[0.72rem] font-medium whitespace-nowrap cursor-pointer transition-all hover:bg-[#1e4620] hover:text-white hover:border-[#1e4620] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >{{ question.question }}</button>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="flex-shrink-0 bg-white border-t border-[#e1e8e0] px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] md:pb-3 md:rounded-b-2xl">
        <form class="flex items-end gap-2" @submit.prevent="sendBotMessage">
          <!-- Honeypot: hidden from sight and from the tab order, so only a
               script that fills every field it finds will write to it. -->
          <input v-model="honeypot" type="text" name="_h" tabindex="-1" autocomplete="off" aria-hidden="true" class="absolute left-[-9999px] w-px h-px opacity-0 pointer-events-none" />
          <div class="flex-1 min-w-0">
            <label for="public-chatbot-input" class="sr-only">Nhập câu hỏi cho trợ lý</label>
            <input
              id="public-chatbot-input"
              ref="botInputRef"
              type="text"
              placeholder="Hỏi tôi bất cứ điều gì..."
              v-model="botInput"
              :maxlength="limits.maxMessageChars"
              :aria-describedby="botInputError ? 'public-chatbot-error public-chatbot-counter' : 'public-chatbot-counter'"
              :aria-invalid="Boolean(botInputError)"
              :disabled="isSubmitting"
              class="w-full px-4 py-3 rounded-full border border-[#d4e4d2] text-[0.88rem] outline-none bg-[#f8faf8] transition-all focus:border-[#1e4620] focus:bg-white focus:shadow-[0_0_0_3px_rgba(30,70,32,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div v-if="botInputError" class="mt-1 px-4">
              <p id="public-chatbot-error" class="m-0 text-[0.7rem] text-[#b42318]" role="alert">{{ botInputError }}</p>
            </div>
          </div>
          <button type="submit" :disabled="isSubmitting || !botInput.trim()" class="w-11 h-11 rounded-full bg-[#1e4620] text-white border-none flex flex-shrink-0 items-center justify-center cursor-pointer transition-all hover:bg-[#153317] hover:shadow-[0_4px_12px_rgba(30,70,32,0.3)] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-[#a0b89e]" aria-label="Gửi tin nhắn">
            <i class="fa-solid fa-paper-plane text-[0.85rem]"></i>
          </button>
        </form>
        <p id="public-chatbot-counter" class="m-0 mt-1 text-[0.65rem] text-[#9ca3af] text-right px-2" :class="{ '!text-[#b42318]': botInput.length > limits.maxMessageChars * 0.9 }">{{ botInput.length }}/{{ limits.maxMessageChars }}</p>
      </div>
    </div>

    <!-- Toggle button + teaser bubble -->
    <div v-if="showLauncher" class="fixed right-4 bottom-[88px] md:right-6 md:bottom-6 z-[10001] flex flex-col items-end gap-2 transition-all" :class="{ 'opacity-0 pointer-events-none scale-90': isChatbotOpen }">
      <div
        v-if="chatTeaserVisible && !isChatbotOpen"
        class="relative max-w-[220px] bg-white text-[#1f2937] text-[0.8rem] leading-snug px-3.5 py-2.5 rounded-[16px_16px_4px_16px] shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-black/5 animate-fade-slide-up motion-reduce:animate-none cursor-pointer"
        @click="toggleChatbot"
      >
        <p class="m-0">{{ chatTeaserText }}</p>
        <button type="button" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#e5e7eb] text-[#6b7280] text-[0.6rem] flex items-center justify-center border-none cursor-pointer hover:bg-[#d1d5db]" @click.stop="dismissTeaser" aria-label="Đóng">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <button
        ref="chatToggleButton"
        class="chatbot-toggle-btn flex bg-[#1e4620] text-white border border-white/20 px-4 py-2.5 pl-3.5 rounded-[50px] shadow-[0_8px_24px_rgba(30,70,32,0.25)] cursor-pointer items-center gap-2 font-bold text-[0.88rem] transition-all hover:-translate-y-0.5 hover:bg-[#153317] hover:shadow-[0_12px_30px_rgba(30,70,32,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] focus-visible:ring-offset-2 motion-reduce:transition-none"
        aria-controls="public-chatbot-dialog"
        :aria-expanded="isChatbotOpen"
        @click="toggleChatbot"
      >
        <div class="flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <span class="bot-label">Hỏi trợ lý</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useChatbot, type StoredConversation } from '~/composables/useChatbot'

const {
  conversations, activeId, chatMessages, isSubmitting, botInput, botInputError,
  quickQuestions, quickQuestionState, quickQuestionStatusText, limits,
  hydrate, loadQuickQuestions,
  createConversation, switchConversation, deleteConversation, clearChatHistory,
  submitBotQuestion, submitLead,
  isSourceExpanded, sourceDetailOf, toggleSourceDetail, retrySourceDetail,
  isProblemKind, messageKindLabel, messageKindClass,
} = useChatbot()

// Gates every browser-only surface. The composable reads localStorage, so
// rendering during SSR would produce markup the client immediately contradicts.
const clientMounted = ref(false)
const isChatbotOpen = ref(false)
const isConversationListOpen = ref(false)
const isQuickQuestionsExpanded = ref(true)
/** Bound to the honeypot input. Stays empty for a real visitor. */
const honeypot = ref('')

const chatContainer = ref<HTMLElement | null>(null)
const chatbotDialog = ref<HTMLElement | null>(null)
const botInputRef = ref<HTMLInputElement | null>(null)
const chatCloseButton = ref<HTMLButtonElement | null>(null)
const chatToggleButton = ref<HTMLButtonElement | null>(null)

/**
 * The launcher is hidden on /assistant: that page *is* the chat, so a floating
 * button offering to open a smaller copy of it is noise.
 */
const route = useRoute()
const showLauncher = computed(() => route.path !== '/assistant')

// ─── Teaser bubble ───────────────────────────────────────────────────────────
const CHAT_TEASER_MESSAGES = [
  'Bạn cần tìm hiểu về quyền lợi sau khi chấp hành xong án phạt tù?',
  'Tôi có thể giúp bạn tra cứu thủ tục xóa án tích miễn phí.',
  'Cần hỗ trợ tìm việc làm sau khi tái hòa nhập cộng đồng?',
  'Hỏi tôi về chính sách hỗ trợ vay vốn cho người hoàn lương nhé!',
  'Bạn muốn biết về các mô hình tái hòa nhập thành công?',
  'Tôi giúp bạn tìm hiểu quy trình đăng ký tạm trú sau mãn hạn tù.',
  'Cần tư vấn về quyền học nghề, học văn hóa miễn phí?',
]
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

// ─── Open / close ────────────────────────────────────────────────────────────
/**
 * Follows the newest content. During playback this runs every frame, and yanking
 * the view down while someone is scrolled up re-reading an earlier answer fights
 * them for control of the scrollbar — so by default it only follows when they are
 * already at the bottom. The 48px tolerance covers sub-pixel heights and the
 * moment a new line exists but has not been scrolled past.
 *
 * `force` is for opening the panel, switching conversation and first mount, where
 * the container starts at `scrollTop = 0` and the bottom is the intended landing
 * spot rather than somewhere the visitor chose to be.
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

const openChatbot = async () => {
  isChatbotOpen.value = true
  chatTeaserVisible.value = false
  teaserDismissed = true
  stopTeaserCycle()
  if (quickQuestionState.value === 'error' || quickQuestionState.value === 'empty') loadQuickQuestions()
  await nextTick()
  chatCloseButton.value?.focus()
  scrollChatBottom(true)
}

const closeChatbot = async () => {
  isChatbotOpen.value = false
  isConversationListOpen.value = false
  await nextTick()
  chatToggleButton.value?.focus()
}

const toggleChatbot = () => {
  if (isChatbotOpen.value) closeChatbot()
  else openChatbot()
}

// Exposed so the layout's bottom nav and Escape handler can drive the widget
// without owning any of its state.
defineExpose({ openChatbot, closeChatbot, toggleChatbot, isChatbotOpen })

const openFullPage = () => {
  isChatbotOpen.value = false
  navigateTo('/assistant')
}

const handleChatbotDialogKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { closeChatbot(); return }
  if (event.key !== 'Tab' || !chatbotDialog.value) return
  const focusable = [...chatbotDialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])')]
    .filter(element => element.tabIndex !== -1)
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

// The dialog is full-screen on mobile; leaving the page scrollable behind it
// lets a swipe move the page instead of the transcript.
watch(isChatbotOpen, (open) => {
  if (typeof document !== 'undefined') document.body.style.overflow = open ? 'hidden' : ''
})

// ─── Conversations ───────────────────────────────────────────────────────────
const onCreateConversation = () => {
  createConversation()
  isConversationListOpen.value = false
  nextTick(() => botInputRef.value?.focus())
}

const onSwitchConversation = (id: string) => {
  switchConversation(id)
  isConversationListOpen.value = false
  scrollChatBottom(true)
}

const conversationMeta = (conversation: StoredConversation) => {
  const count = conversation.messages.filter(item => item.id !== 'welcome').length
  const when = new Date(conversation.createdAt)
  const stamp = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('vi-VN')
  return count ? `${count} tin nhắn · ${stamp}` : `Chưa có tin nhắn · ${stamp}`
}

// ─── Sending ─────────────────────────────────────────────────────────────────
const sendBotMessage = () => {
  // A filled honeypot means a script drove this form. Dropping it here saves a
  // round-trip; the server checks again because a client-side check protects
  // nothing on its own.
  if (honeypot.value.trim() !== '') return
  submitBotQuestion(botInput.value, followChatBottom).then(() => nextTick(() => botInputRef.value?.focus()))
}

const askBot = (question: string) => {
  if (isSubmitting.value) return
  botInput.value = question
  submitBotQuestion(question, followChatBottom)
}

onMounted(() => {
  clientMounted.value = true
  hydrate()
  loadQuickQuestions()
  startTeaserCycle()
})

onUnmounted(() => {
  stopTeaserCycle()
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

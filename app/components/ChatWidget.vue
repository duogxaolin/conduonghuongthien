<template>
  <div v-if="clientMounted">
    <!-- Chat dialog.
         `visibility` is in the transition only when CLOSING (hidden after the
         fade-out). Opening must make it visible at once: during a visibility
         transition the dialog is still `hidden` at its start, and `focus()` on a
         hidden tree is silently ignored — focus stayed behind the dialog on
         phones (design D24, tests/e2e/chat-widget-focus.spec.ts; same rule as
         DefaultMobileDrawer.vue). Header buttons avoid `transition-all` for the
         same reason: they would transition their inherited visibility. -->
    <div
      id="public-chatbot-dialog"
      ref="chatbotDialog"
      class="fixed inset-0 w-screen h-[100dvh] bg-[#f0f4ef] flex flex-col z-[10008] overflow-hidden invisible opacity-0 pointer-events-none translate-y-[20px] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none md:inset-auto md:fixed md:right-5 md:bottom-5 md:w-[min(460px,calc(100vw-40px))] md:h-[min(680px,calc(100dvh-100px))] lg:w-[520px] lg:h-[min(760px,calc(100dvh-110px))] md:rounded-2xl md:shadow-[0_25px_60px_rgba(0,0,0,0.2)] md:border md:border-black/10 md:translate-y-3 md:scale-[0.96]"
      :class="isChatbotOpen ? '!visible !opacity-100 !pointer-events-auto !translate-y-0 md:!scale-100 transition-[opacity,transform]' : 'transition-[opacity,transform,visibility]'"
      :style="keyboardViewportStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-chatbot-title"
      :aria-hidden="!isChatbotOpen"
      :inert="!isChatbotOpen"
    >
      <!-- Header -->
      <div class="flex-shrink-0 bg-brand-900 px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3 md:pt-3 md:rounded-t-2xl">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button class="md:hidden w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/90 text-[1rem] border-none cursor-pointer transition-[background-color,transform] active:scale-90" @click="closeChatbot" :aria-label="t('cw_back')">
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
          <div class="flex items-center gap-2 md:gap-1.5">
            <button
              class="w-10 h-10 md:w-8 md:h-8 rounded-full bg-white/10 border-none text-white/80 flex items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90"
              @click="isConversationListOpen = !isConversationListOpen"
              :aria-expanded="isConversationListOpen"
              :title="t('cw_history')"
              :aria-label="t('cw_history')"
            >
              <i class="fa-solid fa-clock-rotate-left text-[0.9rem] md:text-[0.8rem]"></i>
            </button>
            <button class="w-10 h-10 md:w-8 md:h-8 rounded-full bg-white/10 border-none text-white/80 flex items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90" @click="clearChatHistory" :title="t('cw_clear')" :aria-label="t('cw_clear')">
              <i class="fa-solid fa-broom text-[0.9rem] md:text-[0.8rem]"></i>
            </button>
            <!-- Expand: desktop/iPad only. The full page is a two-column layout
                 that has no room to be useful on a phone. -->
            <button class="hidden md:flex w-8 h-8 rounded-full bg-white/10 border-none text-white/80 items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90" @click="openFullPage" :title="t('cw_expand')" :aria-label="t('cw_expand')">
              <i class="fa-solid fa-up-right-and-down-left-from-center text-[0.75rem]"></i>
            </button>
            <button ref="chatCloseButton" class="hidden md:flex w-8 h-8 rounded-full bg-white/10 border-none text-white/80 items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" @click="closeChatbot" aria-label="Đóng">
              <i class="fa-solid fa-xmark text-[0.9rem]"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Conversation list (collapsible drawer) -->
      <div v-if="isConversationListOpen" class="flex-shrink-0 border-b border-[#e1e8e0] bg-white max-h-[40%] overflow-y-auto overscroll-contain">
        <div class="flex items-center justify-between px-3 py-2 border-b border-[#f0f4ef]">
          <span class="text-[0.72rem] font-bold uppercase tracking-wide text-[#6b7280]">Cuộc trò chuyện</span>
          <button type="button" class="flex items-center gap-1 rounded-full bg-brand-900 px-2.5 py-1 text-[0.7rem] font-bold text-white border-none cursor-pointer hover:bg-[#153317]" @click="onCreateConversation">
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
      <div ref="chatContainer" class="flex-1 min-h-0 px-4 py-5 overflow-y-auto overscroll-contain" aria-live="polite" aria-relevant="additions text">
        <!-- Khối nội dung tách khỏi khung cuộn để ResizeObserver thấy nó cao lên
             (ảnh tải xong, chi tiết công cụ hiện ra) và giữ khung bám đáy. -->
        <div ref="chatContent" class="flex flex-col gap-4">
        <div v-if="chatMessages.length <= 1" class="mx-auto mt-4 mb-2 max-w-[280px] text-center">
          <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-brand-900/10 flex items-center justify-center">
            <i class="fa-solid fa-shield-halved text-brand-900 text-[1.4rem]"></i>
          </div>
          <p class="text-[0.82rem] text-ink-secondary leading-relaxed m-0">Xin chào! Tôi hỗ trợ tra cứu thông tin từ kho dữ liệu đã được <strong class="text-brand-900">Cục C11</strong> phê duyệt.</p>
        </div>

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
                    ? 'bg-[#fff0ef] text-[#b42318] border border-[#f0c0c0] rounded-[18px_4px_18px_18px]'
                    : 'bg-[#1e4620] text-white rounded-[18px_4px_18px_18px] shadow-[0_2px_8px_rgba(30,70,32,0.2)]',
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
              <div v-if="msg.sender === 'bot' && !msg.isStreaming" class="mt-2 flex items-center justify-between gap-2 border-t border-[#e1e8e0] pt-1.5 text-[0.7rem]">
                <span v-if="msg.kind" class="flex items-center gap-1 font-semibold" :class="messageKindClass(msg.kind)" role="status">
                  <i class="fa-solid" :class="isProblemKind(msg.kind) ? 'fa-circle-exclamation text-[#9a3412]' : 'fa-circle-check text-[#1e4620]'" aria-hidden="true"></i>
                  {{ messageKindLabel(msg.kind) }}
                </span>
                <span v-else></span>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 text-[0.7rem] text-[#6b7280] hover:text-brand-900 bg-transparent border-none cursor-pointer p-0.5 rounded transition-colors"
                  @click="copyMessageText(msg.text, msg.id)"
                  :title="copiedMsgId === msg.id ? 'Đã sao chép' : 'Sao chép câu trả lời'"
                >
                  <i :class="copiedMsgId === msg.id ? 'fa-solid fa-check text-[#7CB342]' : 'fa-regular fa-copy'" aria-hidden="true"></i>
                  {{ copiedMsgId === msg.id ? 'Đã chép' : 'Sao chép' }}
                </button>
              </div>
              <ul v-if="msg.sources?.length && !msg.isStreaming" class="mt-1.5 mb-0 space-y-1 border-t border-[#e1e8e0] pt-1.5 list-none pl-0" :aria-label="t('cw_sources')">
                <li v-for="source in msg.sources" :key="source.id" class="text-[0.68rem] leading-snug text-ink-secondary">
                  <i class="fa-solid fa-link text-[0.5rem] text-[#7CB342] mr-1" aria-hidden="true"></i>
                  <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-brand-900 underline underline-offset-2">{{ source.label }}</a>
                  <span v-else class="font-semibold">{{ source.label }}</span>
                  <span v-if="source.reference" class="text-[#6b7280]"> — {{ source.reference }}</span>

                  <!-- Most imported rows have a label and no URL, so this is the
                       only way to read the approved text behind the citation. -->
                  <button
                    v-if="source.entryId !== null"
                    type="button"
                    class="ml-1 inline-flex items-center gap-0.5 rounded-full border border-[#d4e4d2] bg-[#f0f6ef] px-1.5 py-px text-[0.62rem] font-semibold text-brand-900 cursor-pointer transition-colors hover:bg-brand-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    :aria-expanded="isSourceExpanded(source.entryId)"
                    @click="toggleSourceDetail(source.entryId)"
                  >
                    <i class="fa-solid fa-book-open text-[0.55rem]" aria-hidden="true"></i>
                    {{ isSourceExpanded(source.entryId) ? 'Thu gọn' : 'Xem đầy đủ' }}
                  </button>

                  <div v-if="isSourceExpanded(source.entryId)" class="mt-1 rounded-lg border border-[#e1e8e0] bg-[#f8faf8] px-2 py-1.5">
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
              <div v-if="msg.askContact && msg.lead && !msg.isStreaming" class="mt-3 border-t border-[#e1e8e0] pt-3">
                <p v-if="msg.lead.status === 'done'" class="m-0 text-[0.78rem] font-semibold text-brand-900"><i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i> Đã gửi thông tin. Cán bộ sẽ liên hệ với anh/chị trong thời gian sớm nhất. Cảm ơn ạ!</p>
                <form v-else class="flex flex-col gap-2" @submit.prevent="submitLead(msg)">
                  <p class="m-0 text-[0.75rem] font-bold text-[#1f2937]">Để lại thông tin liên hệ</p>
                  <!-- Nhãn sr-only: placeholder biến mất khi gõ và không phải tên truy cập đáng tin. -->
                  <label :for="leadFieldId(uid, msg.id || index, 'name')" class="sr-only">{{ t('cw_lead_name') }}</label>
                  <input :id="leadFieldId(uid, msg.id || index, 'name')" v-model="msg.lead.name" type="text" autocomplete="name" :placeholder="t('cw_lead_name')" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900" />
                  <label :for="leadFieldId(uid, msg.id || index, 'phone')" class="sr-only">{{ t('cw_lead_phone') }}</label>
                  <input :id="leadFieldId(uid, msg.id || index, 'phone')" v-model="msg.lead.phone" type="tel" autocomplete="tel" :placeholder="t('cw_lead_phone')" :aria-invalid="leadContactInvalid(msg.lead) ? 'true' : undefined" :aria-describedby="msg.lead.error ? leadFieldId(uid, msg.id || index, 'error') : undefined" class="w-full rounded-lg border bg-[#f8faf8] px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900" :class="leadContactInvalid(msg.lead) ? 'border-[#b42318]' : 'border-[#d4e4d2]'" />
                  <label :for="leadFieldId(uid, msg.id || index, 'email')" class="sr-only">{{ t('cw_lead_email') }}</label>
                  <input :id="leadFieldId(uid, msg.id || index, 'email')" v-model="msg.lead.email" type="email" autocomplete="email" :placeholder="t('cw_lead_email')" :aria-invalid="leadContactInvalid(msg.lead) ? 'true' : undefined" :aria-describedby="msg.lead.error ? leadFieldId(uid, msg.id || index, 'error') : undefined" class="w-full rounded-lg border bg-[#f8faf8] px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900" :class="leadContactInvalid(msg.lead) ? 'border-[#b42318]' : 'border-[#d4e4d2]'" />
                  <label :for="leadFieldId(uid, msg.id || index, 'question')" class="sr-only">{{ t('cw_lead_question') }}</label>
                  <textarea :id="leadFieldId(uid, msg.id || index, 'question')" v-model="msg.lead.question" rows="2" :placeholder="t('cw_lead_question')" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-base md:text-[0.8rem] outline-none focus:border-brand-900"></textarea>
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
          <div class="bg-white px-3.5 py-2.5 rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-[#e8efe8] max-w-xs" role="status" aria-live="polite">
            <span class="sr-only">Trợ lý đang soạn câu trả lời</span>
            <div class="flex items-center gap-1.5 text-[0.72rem] font-semibold text-brand-700">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7CB342] opacity-75"></span>
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
        class="flex-shrink-0 m-0 border-t border-[#e1e8e0] bg-white px-4 py-2 text-[0.72rem] text-ink-muted"
        role="status"
        aria-live="polite"
      >{{ quickQuestionStatusText }}</p>
      <p v-else class="sr-only" role="status" aria-live="polite">{{ quickQuestionStatusText }}</p>

      <!-- Quick questions -->
      <div v-if="quickQuestionState === 'success' && quickQuestions.length" class="flex-shrink-0 border-t border-[#e1e8e0]">
        <button type="button" class="w-full px-4 py-2 bg-white text-[0.75rem] font-semibold text-ink-secondary flex items-center justify-between border-none cursor-pointer transition-all hover:bg-[#f8faf8]" @click="isQuickQuestionsExpanded = !isQuickQuestionsExpanded">
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
              class="bg-[#f0f6ef] border border-[#d4e4d2] text-[#2d4a2d] px-2.5 py-1 rounded-full text-[0.72rem] font-medium whitespace-nowrap cursor-pointer transition-all hover:bg-brand-900 hover:text-white hover:border-brand-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
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
            <label for="public-chatbot-input" class="sr-only">{{ t('cw_input_label') }}</label>
            <input
              id="public-chatbot-input"
              ref="botInputRef"
              type="text"
              :placeholder="t('cw_input_placeholder')"
              v-model="botInput"
              :maxlength="limits.maxMessageChars"
              :aria-describedby="botInputError ? 'public-chatbot-error public-chatbot-counter' : 'public-chatbot-counter'"
              :aria-invalid="Boolean(botInputError)"
              :disabled="isSubmitting"
              class="w-full px-4 py-3 rounded-full border border-[#d4e4d2] text-base md:text-[0.88rem] outline-none bg-[#f8faf8] transition-all focus:border-brand-900 focus:bg-white focus:shadow-[0_0_0_3px_rgba(30,70,32,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div v-if="botInputError" class="mt-1 px-4">
              <p id="public-chatbot-error" class="m-0 text-[0.7rem] text-[#b42318]" role="alert">{{ botInputError }}</p>
            </div>
          </div>
          <button type="submit" :disabled="isSubmitting || !botInput.trim()" class="w-11 h-11 rounded-full bg-brand-900 text-white border-none flex flex-shrink-0 items-center justify-center cursor-pointer transition-all hover:bg-[#153317] hover:shadow-[0_4px_12px_rgba(30,70,32,0.3)] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-[#a0b89e]" :aria-label="t('cw_send_aria')">
            <i class="fa-solid fa-paper-plane text-[0.85rem]"></i>
          </button>
        </form>
        <p id="public-chatbot-counter" class="m-0 mt-1 text-[0.65rem] text-[#9ca3af] text-right px-2" :class="{ '!text-[#b42318]': botInput.length > limits.maxMessageChars * 0.9 }">{{ botInput.length }}/{{ limits.maxMessageChars }}</p>
      </div>
    </div>

    <!-- Toggle button + teaser bubble -->
    <div v-if="showLauncher" class="fixed right-4 bottom-[88px] md:right-6 md:bottom-6 z-[10001] hidden md:flex flex-col items-end gap-2 transition-all" :class="{ 'opacity-0 pointer-events-none scale-90': isChatbotOpen }">
      <div
        v-if="chatTeaserVisible && !isChatbotOpen"
        class="hidden xl:block relative max-w-[220px] bg-white text-[#1f2937] text-[0.8rem] leading-snug px-3.5 py-2.5 rounded-[16px_16px_4px_16px] shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-black/5 animate-fade-slide-up motion-reduce:animate-none cursor-pointer"
        @click="toggleChatbot"
      >
        <p class="m-0">{{ chatTeaserText }}</p>
        <button type="button" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#e5e7eb] text-[#6b7280] text-[0.6rem] flex items-center justify-center border-none cursor-pointer hover:bg-[#d1d5db]" @click.stop="dismissTeaser" aria-label="Đóng">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <button
        ref="chatToggleButton"
        class="chatbot-toggle-btn flex bg-brand-900 text-white border border-white/20 px-4 py-2.5 pl-3.5 rounded-[50px] shadow-[0_8px_24px_rgba(30,70,32,0.25)] cursor-pointer items-center gap-2 font-bold text-[0.88rem] transition-all hover:-translate-y-0.5 hover:bg-[#153317] hover:shadow-[0_12px_30px_rgba(30,70,32,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-900 motion-reduce:transition-none"
        aria-controls="public-chatbot-dialog"
        :aria-expanded="isChatbotOpen"
        @click="toggleChatbot"
      >
        <div class="flex items-center justify-center">
          <i class="fa-solid fa-comment-dots text-[1.05rem]" aria-hidden="true"></i>
        </div>
        <span class="bot-label">{{ t('ask_ai') || 'Hỏi trợ lý' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, useId } from 'vue'
import { leadContactInvalid, leadFieldId } from '~/utils/form-a11y'
import { createFocusReturn, inertOutside, trapTabTarget, visibleTabbables } from '~/utils/focus-return'
import { useChatbot, type StoredConversation, type ChatMessage } from '~/composables/useChatbot'
import { useChatAutoScroll } from '~/composables/useChatAutoScroll'
import { useKeyboardViewport } from '~/composables/useKeyboardViewport'
import { useSlowWait } from '~/composables/useSlowWait'
import { useI18n } from '~/composables/useI18n'

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
  isProblemKind, messageKindLabel, messageKindClass,
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
const botInputRef = ref<HTMLInputElement | null>(null)
const chatCloseButton = ref<HTMLButtonElement | null>(null)
const chatToggleButton = ref<HTMLButtonElement | null>(null)

/**
 * The launcher is hidden on /assistant: that page *is* the chat, so a floating
 * button offering to open a smaller copy of it is noise.
 */
const route = useRoute()
const showLauncher = computed(() => route.path !== '/assistant')

const copiedMsgId = ref<string | null>(null)
const copyMessageText = async (text: string, id: string | undefined) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedMsgId.value = id || 'copied'
    setTimeout(() => { copiedMsgId.value = null }, 2000)
  } catch { /* ignore */ }
}
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

// ─── Dialog focus (design D24, same helpers as ConfirmModal) ─────────────────
// Open: remember the opener (the bottom-nav button on phones, the launcher on
// desktop), make the page behind `inert`, focus the first control that is
// actually shown at this width. Close: release the page FIRST (focus() on an
// inert opener does nothing), then return focus to the opener.
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
  chatTeaserVisible.value = false
  teaserDismissed = true
  stopTeaserCycle()
  if (quickQuestionState.value === 'error' || quickQuestionState.value === 'empty') loadQuickQuestions()
  await nextTick()
  if (chatbotDialog.value) {
    if (!releaseOutside) releaseOutside = inertOutside(chatbotDialog.value)
    window.removeEventListener('keydown', onWindowKeydown)
    window.addEventListener('keydown', onWindowKeydown)
    visibleTabbables<HTMLElement>(chatbotDialog.value)[0]?.focus()
  }
  releaseAnchor()
  scrollChatBottom(true)
}

const closeChatbot = async () => {
  const active = document.activeElement
  // Only take focus back if it is still in the dialog (or nowhere): a visitor who
  // already moved on is not yanked back.
  const shouldRestore = !active || active === document.body || !!chatbotDialog.value?.contains(active)
  isChatbotOpen.value = false
  isConversationListOpen.value = false
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

// Exposed so the layout's bottom nav and Escape handler can drive the widget
// without owning any of its state.
defineExpose({ openChatbot, closeChatbot, toggleChatbot, isChatbotOpen })

// Same close path as every other exit, so the page is released and focus goes
// back before the route changes.
const openFullPage = async () => {
  await closeChatbot()
  navigateTo('/assistant')
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
  releaseAnchor()
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

onUnmounted(() => {
  stopTeaserCycle()
  window.removeEventListener('keydown', onWindowKeydown)
  releasePage()
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

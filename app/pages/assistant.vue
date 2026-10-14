<template>
  <div class="bg-[#f0f4ef] py-2 md:py-2.5">
    <div class="mx-auto w-full max-w-[1440px] px-2 sm:px-3 md:px-4">
      <div class="md:grid md:grid-cols-[280px_1fr] lg:grid-cols-[300px_1fr] md:gap-3 lg:gap-3.5 h-[calc(100dvh-235px)] min-h-[440px]">
        <!-- Sidebar: hidden below md. The two-column layout has no room to be
             useful on a phone, and the floating widget already serves that case. -->
        <aside class="hidden md:flex md:flex-col h-full rounded-2xl border border-[#e1e8e0] bg-white overflow-hidden shadow-sm">
          <div class="flex-shrink-0 p-3 border-b border-[#e8efe8] bg-[#fcfdfc]">
            <button
              type="button"
              class="w-full flex items-center justify-between gap-2 rounded-xl bg-[#1e4620] hover:bg-[#153317] text-white px-3.5 py-2.5 text-[0.84rem] font-bold shadow-sm transition-all active:scale-[0.98] border-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]"
              @click="onCreateConversation"
            >
              <span class="flex items-center gap-2">
                <i class="fa-regular fa-pen-to-square text-xs" aria-hidden="true"></i>
                <span>Đoạn chat mới</span>
              </span>
              <span class="w-5 h-5 rounded-md bg-white/15 flex items-center justify-center text-[0.7rem] font-bold">+</span>
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1" :aria-label="t('asst_conversation_list')">
            <p v-if="!conversations.length" class="m-0 px-3 py-6 text-center text-xs text-[#5A6C58]">Chưa có cuộc trò chuyện nào.</p>
            <ul class="list-none m-0 p-0 space-y-1">
              <li v-for="conversation in sortedConversations" :key="conversation.id">
                <!--
                  Hàng = wrapper `div` (kiểu dáng) chứa HAI nút anh em: nút chuyển cuộc trò chuyện
                  và nút xoá. Không biến cả hàng thành <button>: lồng <button> trong <button> là HTML
                  không hợp lệ (parser tách đôi, hydration SSR lệch).
                -->
                <div
                  class="group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all border"
                  :class="conversation.id === activeId
                    ? 'bg-[#f0f7f1] border-[#c8dcc9] shadow-xs'
                    : 'bg-white hover:bg-[#f8faf8] border-transparent hover:border-[#e2ece3]'"
                >
                  <button
                    type="button"
                    class="flex flex-1 min-w-0 items-center gap-2.5 p-0 m-0 bg-transparent border-none text-left font-[inherit] cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741] focus-visible:ring-offset-2"
                    :aria-current="conversation.id === activeId ? 'true' : undefined"
                    @click="onSwitchConversation(conversation.id)"
                  >
                    <!-- Chat icon -->
                    <span
                      class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                      :class="conversation.id === activeId ? 'bg-[#1e4620] text-white' : 'bg-[#f0f4ef] text-[#557757] group-hover:bg-[#e4ece4]'"
                      aria-hidden="true"
                    >
                      <i class="fa-regular fa-message text-[0.7rem]"></i>
                    </span>

                    <!-- Text info -->
                    <span class="flex-1 min-w-0">
                      <span
                        class="block truncate text-[0.82rem] font-bold leading-tight"
                        :class="conversation.id === activeId ? 'text-[#1e4620]' : 'text-[#2d3748] group-hover:text-[#122815]'"
                      >
                        {{ conversation.title }}
                      </span>
                      <span class="block text-[0.68rem] text-[#5A6C58] mt-0.5 truncate">
                        {{ conversationMeta(conversation) }}
                      </span>
                    </span>
                  </button>

                  <!-- Delete button (sleek on hover) -->
                  <button
                    type="button"
                    class="w-6 h-6 flex-shrink-0 rounded-md bg-transparent border-none text-[#5A6C58] hover:text-[#b42318] hover:bg-[#fee2e2] flex items-center justify-center cursor-pointer transition-all opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]"
                    @click.stop="deleteConversation(conversation.id)"
                    :aria-label="`${t('asst_delete_conv_aria')} ${conversation.title}`"
                    :title="t('asst_delete_conv')"
                  >
                    <i class="fa-regular fa-trash-can text-[0.68rem]" aria-hidden="true"></i>
                  </button>
                </div>
              </li>
            </ul>
          </nav>

          <div class="flex-shrink-0 border-t border-[#e1e8e0] px-3 py-2 bg-[#fcfdfc]">
            <p class="m-0 text-[0.68rem] leading-snug text-[#6b7280]">
              Tối đa {{ limits.maxConversations }} cuộc trò chuyện được lưu trên thiết bị này.
            </p>
          </div>
        </aside>

        <!-- Main chat column -->
        <section class="flex flex-col h-full rounded-xl md:rounded-2xl border border-[#e1e8e0] bg-white overflow-hidden shadow-sm">
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
              <button type="button" class="md:hidden w-9 h-9 rounded-full bg-white/10 border-none text-white/85 flex items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90" @click="onCreateConversation" :aria-label="t('asst_new_conv')">
                <i class="fa-solid fa-plus text-[0.8rem]" aria-hidden="true"></i>
              </button>
              <button type="button" class="w-9 h-9 rounded-full bg-white/10 border-none text-white/85 flex items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90" @click="clearChatHistory" :title="t('asst_clear_conv')" :aria-label="t('asst_clear_conv')">
                <i class="fa-solid fa-broom text-[0.8rem]" aria-hidden="true"></i>
              </button>
              <NuxtLink to="/" class="w-9 h-9 rounded-full bg-white/10 text-white/85 flex items-center justify-center no-underline transition-all hover:bg-white/20" :title="t('asst_home')" :aria-label="t('asst_home')">
                <i class="fa-solid fa-house text-[0.8rem]" aria-hidden="true"></i>
              </NuxtLink>
            </div>
          </header>

          <!-- Transcript -->
          <div ref="chatContainer" class="flex-1 overflow-y-auto overscroll-contain bg-[#f8faf8] px-4 py-6 md:px-8" aria-live="polite" aria-relevant="additions text">
            <div ref="chatContent" class="mx-auto flex max-w-[760px] flex-col gap-5">
              <div v-if="chatMessages.filter(m => m.id !== 'welcome').length === 0" class="mx-auto mt-6 max-w-[420px] text-center">
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
                <div v-if="msg.id !== 'welcome'" class="flex gap-3" :class="msg.sender === 'user' ? 'justify-end' : 'justify-start'" :data-chat-anchor="msg.sender === 'user' ? '' : undefined">
                  <div v-if="msg.sender === 'bot'" class="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#1e4620] shadow-sm" aria-hidden="true">
                    <i class="fa-solid fa-robot text-[0.7rem] text-white"></i>
                  </div>
                  <div
                    class="max-w-[85%] break-words px-4 py-3 text-[0.92rem] leading-[1.6] md:max-w-[75%] transition-opacity"
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
                      <button type="button" class="underline font-semibold text-[#1e4620] bg-transparent border-0 cursor-pointer p-0" @click="retryMessage(msg)">Thử lại</button>
                    </div>
                    <div v-if="msg.sender === 'bot' && !msg.isStreaming" class="mt-2 flex items-center justify-between gap-2 border-t border-[#e1e8e0] pt-1.5 text-[0.72rem]">
                      <span v-if="msg.kind" class="flex items-center gap-1 font-semibold" :class="messageKindClass(msg.kind)" role="status">
                        <i class="fa-solid" :class="isProblemKind(msg.kind) ? 'fa-circle-exclamation text-[#9a3412]' : 'fa-circle-check text-[#1e4620]'" aria-hidden="true"></i>
                        {{ messageKindLabel(msg.kind) }}
                      </span>
                      <span v-else></span>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 text-[0.72rem] text-[#6b7280] hover:text-[#1e4620] bg-transparent border-none cursor-pointer p-0.5 rounded transition-colors"
                        @click="copyMessageText(msg.text, msg.id)"
                        :title="copiedMsgId === msg.id ? 'Đã sao chép' : 'Sao chép câu trả lời'"
                      >
                        <i :class="copiedMsgId === msg.id ? 'fa-solid fa-check text-[#7CB342]' : 'fa-regular fa-copy'" aria-hidden="true"></i>
                        {{ copiedMsgId === msg.id ? 'Đã chép' : 'Sao chép' }}
                      </button>
                    </div>
                    <ul v-if="msg.sources?.length && !msg.isStreaming" class="mt-1.5 mb-0 list-none space-y-1 border-t border-[#e1e8e0] pl-0 pt-1.5" :aria-label="t('cw_sources')">
                      <li v-for="source in msg.sources" :key="source.id" class="text-[0.7rem] leading-snug text-[#4A5545]">
                        <i class="fa-solid fa-link mr-1 text-[0.54rem] text-[#7CB342]" aria-hidden="true"></i>
                        <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#1e4620] underline underline-offset-2">{{ source.label }}</a>
                        <span v-else class="font-semibold">{{ source.label }}</span>

                        <button
                          v-if="source.entryId !== null"
                          type="button"
                          class="ml-1 inline-flex cursor-pointer items-center gap-0.5 rounded-full border border-[#d4e4d2] bg-[#f0f6ef] px-2 py-px text-[0.66rem] font-semibold text-[#1e4620] transition-colors hover:bg-[#1e4620] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]"
                          :aria-expanded="isSourceExpanded(source.entryId)"
                          @click="toggleSourceDetail(source.entryId)"
                        >
                          <i class="fa-solid fa-book-open text-[0.56rem]" aria-hidden="true"></i>
                          {{ isSourceExpanded(source.entryId) ? 'Thu gọn' : 'Xem đầy đủ' }}
                        </button>

                        <div v-if="isSourceExpanded(source.entryId)" class="mt-1 rounded-lg border border-[#e1e8e0] bg-[#f8faf8] px-2.5 py-1.5">
                          <p v-if="sourceDetailOf(source.entryId)?.status === 'loading'" class="m-0 text-[0.68rem] text-[#667768]" role="status" aria-live="polite">Đang tải nội dung đầy đủ…</p>
                          <div v-else-if="sourceDetailOf(source.entryId)?.status === 'error'" role="alert">
                            <p class="m-0 text-[0.68rem] text-[#b42318]">Không tải được nội dung đầy đủ.</p>
                            <button type="button" class="mt-1 cursor-pointer rounded-full border-none bg-[#1e4620] px-2.5 py-0.5 text-[0.66rem] font-bold text-white hover:bg-[#153317] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]" @click="retrySourceDetail(source.entryId)">Thử lại</button>
                          </div>
                          <template v-else-if="sourceDetailOf(source.entryId)?.status === 'ready'">
                            <p v-if="sourceDetailOf(source.entryId)?.question" class="m-0 mb-1 text-[0.72rem] font-bold text-[#1e4620]">{{ sourceDetailOf(source.entryId)?.question }}</p>
                            <p class="m-0 whitespace-pre-wrap text-[0.72rem] leading-[1.55] text-[#1f2937]">{{ sourceDetailOf(source.entryId)?.answer }}</p>
                            <nuxt-link :to="`/qa-documents#qa-${source.entryId}`" class="mt-1 inline-block text-[0.68rem] font-bold text-[#1e4620] underline underline-offset-2">Mở trong Tài liệu Hỏi – Đáp →</nuxt-link>
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
                        <!-- Nhãn sr-only: placeholder biến mất khi gõ và không phải tên truy cập đáng tin. -->
                        <label :for="leadFieldId(uid, msg.id || index, 'name')" class="sr-only">{{ t('cw_lead_name') }}</label>
                        <input :id="leadFieldId(uid, msg.id || index, 'name')" v-model="msg.lead.name" type="text" autocomplete="name" :placeholder="t('cw_lead_name')" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-base md:text-[0.84rem] outline-none focus:border-[#1e4620]" />
                        <label :for="leadFieldId(uid, msg.id || index, 'phone')" class="sr-only">{{ t('cw_lead_phone') }}</label>
                        <input :id="leadFieldId(uid, msg.id || index, 'phone')" v-model="msg.lead.phone" type="tel" autocomplete="tel" :placeholder="t('cw_lead_phone')" :aria-invalid="leadContactInvalid(msg.lead) ? 'true' : undefined" :aria-describedby="msg.lead.error ? leadFieldId(uid, msg.id || index, 'error') : undefined" class="w-full rounded-lg border bg-[#f8faf8] px-3 py-2 text-base md:text-[0.84rem] outline-none focus:border-[#1e4620]" :class="leadContactInvalid(msg.lead) ? 'border-[#b42318]' : 'border-[#d4e4d2]'" />
                        <label :for="leadFieldId(uid, msg.id || index, 'email')" class="sr-only">{{ t('cw_lead_email') }}</label>
                        <input :id="leadFieldId(uid, msg.id || index, 'email')" v-model="msg.lead.email" type="email" autocomplete="email" :placeholder="t('cw_lead_email')" :aria-invalid="leadContactInvalid(msg.lead) ? 'true' : undefined" :aria-describedby="msg.lead.error ? leadFieldId(uid, msg.id || index, 'error') : undefined" class="w-full rounded-lg border bg-[#f8faf8] px-3 py-2 text-base md:text-[0.84rem] outline-none focus:border-[#1e4620]" :class="leadContactInvalid(msg.lead) ? 'border-[#b42318]' : 'border-[#d4e4d2]'" />
                        <label :for="leadFieldId(uid, msg.id || index, 'question')" class="sr-only">{{ t('cw_lead_question') }}</label>
                        <textarea :id="leadFieldId(uid, msg.id || index, 'question')" v-model="msg.lead.question" rows="2" :placeholder="t('cw_lead_question')" class="w-full rounded-lg border border-[#d4e4d2] bg-[#f8faf8] px-3 py-2 text-base md:text-[0.84rem] outline-none focus:border-[#1e4620]"></textarea>
                        <p v-if="msg.lead.error" :id="leadFieldId(uid, msg.id || index, 'error')" class="m-0 text-[0.74rem] text-[#b42318]" role="alert">{{ msg.lead.error }}</p>
                        <button type="submit" :disabled="msg.lead.status === 'sending'" class="self-start rounded-full bg-[#1e4620] px-4 py-1.5 text-[0.82rem] font-bold text-white hover:bg-[#153317] disabled:opacity-50">
                          {{ msg.lead.status === 'sending' ? 'Đang gửi...' : 'Gửi thông tin' }}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
                <!-- Gợi ý hỏi tiếp: chỉ dưới câu trả lời mới nhất, khi đã trả lời xong. -->
                <ChatFollowUps
                  v-if="msg.sender === 'bot' && !msg.isStreaming && index === chatMessages.length - 1 && msg.followUps?.length"
                  :questions="msg.followUps"
                  :disabled="isSubmitting"
                  class="pl-[44px]"
                  @ask="askBot"
                />
              </template>

              <!-- One indicator, from send until the first word lands. The bot
                   message is not in the transcript yet, so this never sits beside
                   an empty bubble. -->
              <div v-if="isAwaitingFirstWord" class="flex justify-start gap-3">
                <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#1e4620] shadow-sm" aria-hidden="true">
                  <i class="fa-solid fa-robot text-[0.7rem] text-white"></i>
                </div>
                <div class="rounded-[4px_18px_18px_18px] bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-[#e8efe8] max-w-sm" role="status" aria-live="polite">
                  <span class="sr-only">Trợ lý đang soạn câu trả lời</span>
                  <div class="flex items-center gap-2 text-xs font-semibold text-[#2c6e33]">
                    <span class="relative flex h-2 w-2">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7CB342] opacity-75"></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-[#2c6e33]"></span>
                    </span>
                    <span>Trợ lý đang suy nghĩ &amp; tra cứu dữ liệu...</span>
                  </div>
                  <div class="flex items-center gap-1.5 mt-2" aria-hidden="true">
                    <span class="h-1.5 w-1.5 animate-typing-dot rounded-full bg-[#1e4620] motion-reduce:animate-none motion-reduce:opacity-60"></span>
                    <span class="h-1.5 w-1.5 animate-typing-dot rounded-full bg-[#1e4620] [animation-delay:200ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
                    <span class="h-1.5 w-1.5 animate-typing-dot rounded-full bg-[#1e4620] [animation-delay:400ms] motion-reduce:animate-none motion-reduce:opacity-60"></span>
                  </div>
                  <!-- Sau ~20 giây: nói rõ lần chờ này dài hơn thường (trong vùng role="status"). -->
                  <p v-if="isSlowWait" class="m-0 mt-2 text-[0.78rem] leading-snug text-[#667768]">Đang chờ lâu hơn bình thường, xin anh/chị chờ thêm…</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Input bar: pinned to the bottom of the column so a long transcript
               never scrolls it out of reach. -->
          <div class="flex-shrink-0 border-t border-[#e1e8e0] bg-white px-3 py-2.5 sm:px-4 sm:py-3 md:px-6 md:py-3.5">
            <form class="mx-auto flex max-w-[760px] items-end gap-2" @submit.prevent="sendBotMessage">
              <input v-model="honeypot" type="text" name="_h" tabindex="-1" autocomplete="off" aria-hidden="true" class="absolute left-[-9999px] h-px w-px opacity-0 pointer-events-none" />
              <div class="min-w-0 flex-1">
                <label for="tro-ly-input" class="sr-only">Nhập câu hỏi cho trợ lý</label>
                <textarea
                  id="tro-ly-input"
                  ref="botInputRef"
                  v-model="botInput"
                  rows="1"
                  :placeholder="t('cw_input_placeholder')"
                  :maxlength="limits.maxMessageChars"
                  :aria-describedby="botInputError ? 'tro-ly-error tro-ly-counter' : 'tro-ly-counter'"
                  :aria-invalid="Boolean(botInputError)"
                  :disabled="isSubmitting"
                  class="max-h-[160px] w-full resize-none rounded-2xl border border-[#d4e4d2] bg-[#f8faf8] px-4 py-3 text-base md:text-[0.92rem] leading-relaxed outline-none transition-all focus:border-[#1e4620] focus:bg-white focus:shadow-[0_0_0_3px_rgba(30,70,32,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                  @keydown.enter.exact.prevent="sendBotMessage"
                  @input="autoGrow"
                ></textarea>
                <p v-if="botInputError" id="tro-ly-error" class="m-0 mt-1 px-1 text-[0.74rem] text-[#b42318]" role="alert">{{ botInputError }}</p>
              </div>
              <button
                type="submit"
                :disabled="isSubmitting || !botInput.trim()"
                class="flex h-12 w-12 flex-shrink-0 cursor-pointer items-center justify-center rounded-2xl border-none bg-[#1e4620] text-white transition-all hover:bg-[#153317] hover:shadow-[0_4px_12px_rgba(30,70,32,0.3)] active:scale-90 disabled:cursor-not-allowed disabled:bg-[#a0b89e] disabled:opacity-40"
                :aria-label="t('cw_send_aria')"
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
import { ref, computed, onMounted, nextTick, useId } from 'vue'
import { leadContactInvalid, leadFieldId } from '~/utils/form-a11y'
import { useChatbot, type StoredConversation, type ChatMessage } from '~/composables/useChatbot'
import { useChatAutoScroll } from '~/composables/useChatAutoScroll'
import { useSlowWait } from '~/composables/useSlowWait'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
// Tiền tố id cho biểu mẫu để-lại-liên-hệ (lặp theo từng tin nhắn).
const uid = useId()
const {
  conversations, activeId, activeConversation, chatMessages,
  isSubmitting, isAwaitingFirstWord, botInput, botInputError,
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

// "Waiting longer than usual" once the first word is 20s late.
const isSlowWait = useSlowWait(isAwaitingFirstWord)

const chatContainer = ref<HTMLElement | null>(null)
const chatContent = ref<HTMLElement | null>(null)
const { isPinnedToBottom, pinToBottom, followLatestQuestion, releaseAnchor } = useChatAutoScroll(chatContainer, chatContent)
const botInputRef = ref<HTMLTextAreaElement | null>(null)
/** Bound to the honeypot input. Stays empty for a real visitor. */
const honeypot = ref('')
const copiedMsgId = ref<string | null>(null)
const copyMessageText = async (text: string, id: string | undefined) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedMsgId.value = id || 'copied'
    setTimeout(() => { copiedMsgId.value = null }, 2000)
  } catch { /* ignore */ }
}

/** Newest first, so the conversation just created is at the top of the list. */
const sortedConversations = computed(() => [...conversations.value].sort((a, b) => b.createdAt - a.createdAt))

/**
 * Follows the newest content. During playback this runs every frame, and yanking
 * the view down while someone is scrolled up re-reading an earlier answer fights
 * them for control of the scrollbar — so by default it only follows when they are
 * still pinned to the bottom. "Pinned" comes from their own scrolling
 * (`useChatAutoScroll`), not from measuring after the content grew: a cover image
 * finishing its load used to read as "the visitor scrolled up" and stop the
 * follow mid-answer.
 *
 * `force` is for switching conversation and first mount, where the container
 * starts at `scrollTop = 0` and the bottom is the intended landing spot rather
 * than somewhere the visitor chose to be.
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
  releaseAnchor()
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
  followLatestQuestion()
  void scrollChatBottom(true)
  submitBotQuestion(botInput.value, followChatBottom).then(() => {
    resetInputHeight()
    // Chỉ focus lại ô nhập trên máy có chuột; trên điện thoại focus() làm bàn phím ảo bật lên lại sau mỗi câu trả lời.
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

/** Retry a failed user message by removing the error bubble and re-submitting. */
function retryMessage(msg: ChatMessage) {
  if (isSubmitting.value) return
  const conv = activeConversation.value
  const idx = conv.messages.findIndex(m => m.id === msg.id)
  if (idx !== -1) conv.messages.splice(idx, 1)
  followLatestQuestion()
  submitBotQuestion(msg.text, followChatBottom)
}

onMounted(() => {
  hydrate()
  loadQuickQuestions()
  scrollChatBottom(true)
})
</script>

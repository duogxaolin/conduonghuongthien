<script setup lang="ts">
/**
 * `LiveChat` — phòng chat trực tiếp cho buổi phát video.
 *
 * Không tự mở `EventSource` ở `onMounted`: nó nhận `active` (từ component cha, hỏi
 * `active.get.ts` rồi quyết định có nên vẽ phòng chat hay không). Khi `active`
 * chuyển từ `false` sang `true`, `connect()` mở stream và lịch sử. Khi chuyển ngược
 * lại, `disconnect()` đóng nguồn và xóa mảng tin nhắn — không giữ tin từ một phiên
 * cũ hiện lên đầu phiên mới.
 *
 * ## Tin nhắn là văn bản thuần
 *
 * `{{ message.content }}` + `whitespace-pre-line break-words`. Không `v-html` ở
 * đâu, không ngoại lệ. Máy chủ đã kiểm ký tự điều khiển và trần độ dài; đây chỉ
 * là nơi hiển thị, và không có gì được diễn giải.
 *
 * ## Cuộn đáy chỉ khi người xem ở đáy
 *
 * `followChatBottom` — theo tiền lệ `ChatWidget.vue`. Người xem đang đọc tin cũ
 * và một tin mới đến: tự cuộn xuống là giật khúc họ đang đọc khỏi màn hình. Chỉ
 * tự cuộn khi họ đã ở đáy.
 */
import { ref, watch, nextTick, onUnmounted } from 'vue'

import { useLiveChat, type LiveChatMessage } from '~/composables/useLiveChat'

interface Props {
  /** Có buổi phát nào đang chạy không — do component cha quyết định từ `active.get.ts`. */
  active: boolean
}
const props = defineProps<Props>()

const { messages, connection, liveError, connect, disconnect, sendMessage } = useLiveChat()

const input = ref('')
const followChatBottom = ref(true)
const chatBox = ref<HTMLElement | null>(null)

// Khi `active` chuyển false → true mở phòng; khi true → false dọn dẹp.
watch(() => props.active, async (now, before) => {
  if (now && !before) {
    followChatBottom.value = true
    await connect()
  } else if (!now && before) {
    disconnect()
    messages.value = []
  }
}, { immediate: true })

onUnmounted(() => {
  disconnect()
})

// Cuộn xuống đáy sau mỗi tin mới — chỉ nếu người xem đang ở đáy. `nextTick` để
// đợi DOM cập nhật mảng `messages` trước khi đo `scrollHeight`.
watch(() => messages.value.length, async () => {
  if (followChatBottom.value) {
    await nextTick()
    if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight
  }
})

const handleScroll = () => {
  if (!chatBox.value) return
  const el = chatBox.value
  // 80px là hằng số "đang ở đáy" — đủ rộng cho một tin dài không bị chép là đã
  // rời đáy chỉ vì thanh cuộn nhấp nhô một chút.
  followChatBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

const submit = async () => {
  const text = input.value
  if (!text.trim()) return

  // Clear input optimistically — the message appears immediately in the
  // chat list as a dimmed "pending" bubble. If it fails, the text is
  // already in the failed message bubble, so no data is lost.
  input.value = ''
  followChatBottom.value = true

  const result = await sendMessage(text)
  if (!result.ok) {
    // The optimistic message is already marked as failed (red, with error
    // text) inside the messages list. No need to push a separate system
    // message — that would duplicate the error in two places.
    // But if the error was a pre-send validation (empty, too long, not
    // connected), no optimistic message was pushed, so we DO need to
    // show it. Check: if the message isn't in the list, push system msg.
    const hasFailedMsg = messages.value.some(m => m.error === result.reason)
    if (!hasFailedMsg) {
      messages.value.push({
        id:        -Date.now(),
        displayName: 'Hệ thống',
        content:    result.reason,
        createdAt:  new Date().toISOString(),
      } as LiveChatMessage)
    }
  }
}

const handleKeydown = (ev: KeyboardEvent) => {
  // Enter gửi, Shift+Enter xuống dòng — cùng quy ước chat mọi nơi
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    submit()
  }
}
</script>

<template>
  <section
    class="flex h-full flex-col bg-[#f7f9f6]"
    aria-label="Phòng chat trực tiếp"
  >
    <!-- Thanh đầu: trạng thái kết nối -->
    <div class="flex items-center justify-between border-b border-black/10 px-4 py-2.5">
      <div class="flex items-center gap-2 text-sm text-gray-700">
        <span
          class="h-2 w-2 rounded-full motion-reduce:animate-none"
          :class="connection === 'open' ? 'bg-green-500 animate-pulse' : connection === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-gray-300'"
          aria-hidden="true"
        />
        <span>{{ connection === 'open' ? 'Đang theo dõi' : connection === 'connecting' ? 'Đang kết nối…' : 'Đã đóng' }}</span>
      </div>
      <button
        type="button"
        class="text-sm text-gray-500 hover:text-[#3a5a40] disabled:text-gray-300"
        :disabled="connection !== 'open'"
        @click="disconnect"
      >
        <i class="fa-solid fa-circle-stop mr-1" aria-hidden="true" />
        Dừng
      </button>
    </div>

    <!-- Dòng tin nhắn -->
    <div
      ref="chatBox"
      class="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 text-sm"
      @scroll="handleScroll"
    >
      <p v-if="messages.length === 0 && connection === 'open'" class="text-center text-gray-400 py-4">
        Chưa có tin nhắn. Hãy gửi câu đầu tiên!
      </p>

      <p
        v-if="liveError"
        class="mt-2 rounded-md bg-amber-50 px-3 py-2 text-amber-800"
        role="status"
      >
        {{ liveError }}
      </p>

      <div
        v-for="msg in messages"
        :key="msg.id"
        class="rounded-md px-3 py-1.5 whitespace-pre-line break-words transition-opacity"
        :class="msg.status === 'pending'
          ? 'bg-blue-50 text-gray-600 shadow-sm border border-blue-200 opacity-75'
          : msg.error
            ? 'bg-red-50 text-red-800 shadow-sm border border-red-200'
            : 'bg-white text-gray-800 shadow-sm'"
      >
        <span class="font-semibold text-[#3a5a40]">{{ msg.displayName }}</span>
        <span class="ml-1.5 text-gray-800">{{ msg.content }}</span>
        <span v-if="msg.status === 'pending'" class="inline-flex items-center gap-1 ml-1.5 text-xs text-blue-500 font-medium">
          <i class="fa-solid fa-circle-notch fa-spin text-[0.6rem]" aria-hidden="true"></i>
          Đang gửi…
        </span>
        <span v-if="msg.error" class="block mt-0.5 text-xs text-red-600 font-medium" role="alert">
          <i class="fa-solid fa-circle-exclamation mr-1 text-[0.6rem]" aria-hidden="true"></i>{{ msg.error }}
        </span>
      </div>
    </div>

    <!-- Khung soạn -->
    <div class="border-t border-black/10 p-3">
      <form @submit.prevent="submit" class="flex items-center gap-2">
        <input
          v-model="input"
          type="text"
          maxlength="200"
          placeholder="Nhập tin nhắn…"
          class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#3a5a40] focus:outline-none focus:ring-1 focus:ring-[#3a5a40] disabled:bg-gray-100 disabled:text-gray-400"
          :disabled="connection !== 'open'"
          @keydown="handleKeydown"
          aria-label="Tin nhắn"
        >
        <button
          type="submit"
          class="inline-flex items-center gap-1 rounded-md bg-[#3a5a40] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d4a32] disabled:opacity-50"
          :disabled="connection !== 'open' || !input.trim()"
        >
          <i class="fa-solid fa-paper-plane" aria-hidden="true" />
          <span class="sr-only">Gửi</span>
        </button>
      </form>
      <p class="mt-1 text-xs text-gray-400">Enter để gửi, Shift+Enter để xuống dòng.</p>
    </div>
  </section>
</template>

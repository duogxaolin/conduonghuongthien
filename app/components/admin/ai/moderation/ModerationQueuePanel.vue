<script setup lang="ts">
import { formatModerationTime as formatTime } from '~/utils/moderation-format'
import type { ModerationQueueItem, ModerationResolveAction } from '~/types/moderation'

/**
 * Tab "Sổ đối soát nội dung bị ẩn" of `/admin/ai/moderation` — presentational. The page
 * owns the list (`useAdminList`: status filter, paging, the latest-request guard) and
 * every action; this panel shows one page of it and says what the officer picked.
 * A failed reload arrives as the page's `#error` slot and takes the table's place.
 */
defineProps<{
  queue: ModerationQueueItem[]
  queueStatusFilter: string
  queuePage: number
  queueTotalPages: number
  queueTotal: number
}>()

const emit = defineEmits<{
  'select-filter': [status: string]
  'change-page': [page: number]
  resolve: [item: ModerationQueueItem, action: ModerationResolveAction]
}>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Status Filter -->
    <div class="flex flex-wrap items-center gap-2 bg-white p-3 rounded-xl border border-[#e2ece3]">
      <span class="text-xs font-bold text-[#667768]">Lọc trạng thái:</span>
      <button
        v-for="s in [
          { key: 'pending', label: 'Chờ đối soát' },
          { key: 'approved', label: 'Đã duyệt an toàn' },
          { key: 'rejected', label: 'Đã xóa' },
          { key: 'banned', label: 'Đã cấm IP' },
          { key: 'all', label: 'Tất cả' }
        ]"
        :key="s.key"
        type="button"
        class="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border"
        :class="queueStatusFilter === s.key ? 'bg-[#2c6e33] text-white border-[#2c6e33]' : 'bg-white text-[#667768] border-[#d0ddd1] hover:bg-[#f0f7f1]'"
        @click="emit('select-filter', s.key)"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- Lượt tải hàng đợi hỏng sau lần tải đầu: nhánh lỗi do TRANG cấp (slot), thay cho bảng —
         hàng đang hiện không còn khớp bộ lọc/trang vừa chọn. -->
    <slot v-if="$slots.error" name="error" />

    <!-- Empty state -->
    <div v-else-if="queue.length === 0" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center text-sm text-[#667768]">
      <i class="fa-solid fa-shield-check text-4xl text-[#2c6e33] mb-3 block"></i>
      Không có mục nào trong danh sách đối soát. Hệ thống an ninh đang hoạt động tốt.
    </div>

    <!-- Queue table -->
    <div v-else class="rounded-xl border border-[#e2ece3] bg-white overflow-x-auto shadow-xs">
      <table class="w-full text-xs">
        <thead class="bg-[#f7faf7] text-left">
          <tr>
            <th class="px-3.5 py-3 font-bold text-[#122815]">Thời gian</th>
            <th class="px-3.5 py-3 font-bold text-[#122815]">Nguồn & Vị trí ẩn</th>
            <th class="px-3.5 py-3 font-bold text-[#122815]">Người gửi / IP</th>
            <th class="px-3.5 py-3 font-bold text-[#122815]">Nội dung vi phạm</th>
            <th class="px-3.5 py-3 font-bold text-[#122815]">Lý do phân tích</th>
            <th class="px-3.5 py-3 font-bold text-[#122815]">Mức độ</th>
            <th class="px-3.5 py-3 font-bold text-[#122815]">Trạng thái</th>
            <th class="px-3.5 py-3 font-bold text-[#122815] text-right">Thao tác đối soát</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in queue" :key="item.id" class="border-t border-[#e2ece3] hover:bg-[#fcfdfc]">
            <td class="px-3.5 py-2.5 whitespace-nowrap text-[#667768]">{{ formatTime(item.createdAt) }}</td>
            <td class="px-3.5 py-2.5">
              <span class="inline-block px-2 py-0.5 rounded font-bold uppercase text-[0.65rem]" :class="item.targetType === 'comment' ? 'bg-blue-100 text-blue-800' : item.targetType === 'chat' ? 'bg-purple-100 text-purple-800' : item.targetType === 'livestream_chat' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                {{ item.targetType === 'comment' ? 'Bình luận' : item.targetType === 'chat' ? 'Chat AI' : item.targetType === 'livestream_chat' ? 'Livestream' : 'Bài viết' }}
              </span>
              <!-- Vị trí cụ thể: bài viết / video / phiên chat -->
              <div v-if="item.contextTitle" class="mt-1 max-w-[220px]">
                <a v-if="item.contextUrl" :href="item.contextUrl" target="_blank" class="block font-bold text-[#1e4620] hover:underline truncate text-xs" :title="item.contextTitle">
                  {{ item.contextTitle }}
                </a>
                <span v-else class="block font-bold text-[#1e4620] truncate text-xs" :title="item.contextTitle">
                  {{ item.contextTitle }}
                </span>
              </div>
              <!-- Session ID nếu có -->
              <div v-if="item.sessionId" class="mt-0.5">
                <nuxt-link :to="`/admin/chatbot/sessions?search=${encodeURIComponent(item.sessionId)}`" class="text-[0.68rem] font-mono text-[#6b7280] hover:text-[#1e4620] underline">
                  Session: {{ item.sessionId.slice(0, 8) }}...
                </nuxt-link>
              </div>
            </td>
            <td class="px-3.5 py-2.5 whitespace-nowrap">
              <strong class="text-[#122815]">{{ item.authorName || 'Khách' }}</strong>
              <div v-if="item.authorIp" class="flex items-center gap-1.5 mt-0.5">
                <span class="text-[0.68rem] text-[#667768] font-mono">{{ item.authorIp }}</span>
                <span v-if="item.isIpBanned" class="px-1.5 py-px rounded text-[0.62rem] font-bold bg-red-100 text-red-700 border border-red-200">
                  Đã cấm
                </span>
              </div>
            </td>
            <td class="px-3.5 py-2.5 max-w-xs break-words">
              <p class="m-0 text-red-900 bg-red-50 p-2.5 rounded border border-red-200 text-xs leading-relaxed font-medium">
                {{ item.contentSnippet }}
              </p>
            </td>
            <td class="px-3.5 py-2.5 max-w-[240px] break-words text-xs text-[#b42318] leading-relaxed">
              {{ item.flaggedReason }}
            </td>
            <td class="px-3.5 py-2.5 whitespace-nowrap">
              <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem] uppercase" :class="item.severity === 'critical' ? 'bg-red-600 text-white' : item.severity === 'high' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                {{ item.severity === 'critical' ? 'Nguy hiểm' : item.severity === 'high' ? 'Cao' : 'Trung bình' }}
              </span>
            </td>
            <td class="px-3.5 py-2.5 whitespace-nowrap">
              <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem]" :class="item.status === 'pending' ? 'bg-orange-100 text-orange-800 border border-orange-300' : item.status === 'approved' ? 'bg-green-100 text-green-800' : item.status === 'banned' ? 'bg-gray-800 text-white' : 'bg-red-100 text-red-800'">
                {{ item.status === 'pending' ? 'Đã ẩn (Chờ duyệt)' : item.status === 'approved' ? 'Đã duyệt an toàn' : item.status === 'banned' ? 'Đã cấm IP' : 'Đã xóa' }}
              </span>
            </td>
            <td class="px-3.5 py-2.5 whitespace-nowrap text-right">
              <div class="flex items-center justify-end gap-1.5 flex-wrap">
                <button
                  v-if="item.status === 'pending'"
                  type="button"
                  class="px-2.5 py-1 rounded bg-[#2c6e33] hover:bg-[#1e4620] text-white text-[0.7rem] font-bold cursor-pointer border-none shadow-2xs"
                  title="Duyệt nội dung an toàn và cho phép hiển thị lại"
                  @click="emit('resolve', item, 'approve')"
                >
                  <i class="fa-solid fa-check mr-1"></i> Bỏ ẩn
                </button>
                <button
                  v-if="item.status !== 'rejected'"
                  type="button"
                  class="px-2.5 py-1 rounded bg-[#fee2e2] hover:bg-[#fca5a5] text-[#b42318] text-[0.7rem] font-bold cursor-pointer border-none shadow-2xs"
                  title="Xóa vĩnh viễn nội dung vi phạm"
                  @click="emit('resolve', item, 'reject_delete')"
                >
                  <i class="fa-solid fa-trash-can mr-1"></i> Xóa
                </button>
                <button
                  v-if="item.authorIp"
                  type="button"
                  class="px-2.5 py-1 rounded text-[0.7rem] font-bold cursor-pointer border flex items-center gap-1 shadow-2xs transition-colors"
                  :class="item.isIpBanned
                    ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                    : 'bg-[#991b1b] hover:bg-[#7f1d1d] text-white border-transparent'"
                  :disabled="item.isIpBanned"
                  :title="item.isIpBanned ? 'Địa chỉ IP này đã bị cấm' : `Cấm địa chỉ IP ${item.authorIp}`"
                  @click="emit('resolve', item, 'ban_ip')"
                >
                  <i class="fa-solid fa-ban"></i>
                  <span>{{ item.isIpBanned ? 'Đã cấm IP' : 'Cấm IP' }}</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Phân trang queue — server trả page/total/totalPages, không viết tay.
         Trang 1/1 không có gì để chuyển nên ẩn luôn; đang lỗi thì số trang là của lượt cũ, ẩn luôn. -->
    <div v-if="queueTotalPages > 1 && !$slots.error" class="px-1">
      <AdminPagination
        :page="queuePage"
        :total-pages="queueTotalPages"
        :total="queueTotal"
        item-label="mục"
        @update:page="emit('change-page', $event)"
      />
    </div>
  </div>
</template>

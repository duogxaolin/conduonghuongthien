<script setup lang="ts">
/**
 * Thanh trên của trình dựng trang (`pages/admin/content/pages/[id].vue`): quay lại, tiêu đề +
 * đường dẫn, trạng thái lưu, "Hủy sửa", "Phiên bản", "Xem trang", "Cấu hình", "Xuất bản".
 * Tách khỏi trang (wave3 4.2): chỉ hiển thị — trang và trạng thái vào qua props, bấm nút phát
 * sự kiện, trang làm việc.
 */
import { computed } from 'vue'
import type { AdminPageDetail } from '~/types/admin-api'

const props = defineProps<{
  page: AdminPageDetail['page'] | null
  /**
   * Trang đã tải xong (cờ dương của trang). Chưa thì "Hủy sửa", "Phiên bản", "Cấu hình",
   * "Xuất bản" tắt — trước đây "Xuất bản" bật và xuất bản cây RỖNG (FINDING-B2).
   */
  loaded: boolean
  /** Trạng thái mạng của lượt lưu nháp (độc lập với trạng thái xuất bản). */
  draftStatus: 'idle' | 'saving' | 'saved' | 'error'
  hasUnpublished: boolean
  publishing: boolean
}>()

const emit = defineEmits<{ 'discard': [], 'open-versions': [], 'open-meta': [], 'publish': [] }>()

// Chữ + biểu tượng + màu của trạng thái lưu (đang xuất bản / đang lưu / lỗi / nháp / đã xuất bản).
const saveState = computed(() => {
  if (props.publishing) return { text: 'Đang xuất bản…', icon: 'fa-solid fa-spinner fa-spin', color: 'text-gray-500' }
  if (props.draftStatus === 'saving') return { text: 'Đang lưu nháp…', icon: 'fa-solid fa-spinner fa-spin', color: 'text-gray-500' }
  if (props.draftStatus === 'error') return { text: 'Lỗi lưu nháp', icon: 'fa-solid fa-triangle-exclamation', color: 'text-red-600' }
  if (props.hasUnpublished) return { text: 'Nháp — chưa xuất bản', icon: 'fa-solid fa-pen', color: 'text-orange-500' }
  return { text: 'Đã xuất bản', icon: 'fa-solid fa-circle-check', color: 'text-green-600' }
})
</script>

<template>
  <div class="flex shrink-0 items-center justify-between border-b border-gray-200 pb-3">
    <div class="flex items-center gap-3">
      <nuxt-link to="/admin/content/pages" class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50">
        <i class="fa-solid fa-arrow-left"></i>
      </nuxt-link>
      <div>
        <h1 class="text-lg font-bold text-gray-800">{{ page?.title || 'Trình dựng trang' }}</h1>
        <p class="mt-0.5 text-xs text-gray-500">
          <code class="rounded bg-gray-100 px-1.5 py-0.5">/{{ page?.slug === 'home' ? '' : page?.slug }}</code>
          <span v-if="page?.isSystem" class="ml-2 text-blue-600"><i class="fa-solid fa-lock"></i> Trang hệ thống</span>
        </p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span class="mr-1 flex items-center gap-1.5 text-xs font-semibold" :class="saveState.color">
        <i :class="saveState.icon"></i> {{ saveState.text }}
      </span>
      <button v-if="hasUnpublished" class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50" title="Bỏ thay đổi chưa xuất bản" :disabled="!loaded" @click="emit('discard')">
        <i class="fa-solid fa-rotate-left mr-1"></i> Hủy sửa
      </button>
      <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50" :disabled="!loaded" @click="emit('open-versions')">
        <i class="fa-solid fa-clock-rotate-left mr-1"></i> Phiên bản
      </button>
      <nuxt-link v-if="page" :to="page.slug === 'home' ? '/' : `/${page.slug}`" target="_blank" class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
        <i class="fa-solid fa-up-right-from-square mr-1"></i> Xem trang
      </nuxt-link>
      <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50" :disabled="!loaded" @click="emit('open-meta')">
        <i class="fa-solid fa-gear mr-1"></i> Cấu hình
      </button>
      <button
        class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:opacity-50"
        :disabled="publishing || !loaded || !hasUnpublished"
        @click="emit('publish')"
      >
        <i :class="publishing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-cloud-arrow-up'"></i>
        {{ publishing ? 'Đang xuất bản…' : 'Xuất bản' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AdminMediaItem } from '~/types/admin-api'

const props = defineProps<{
  item?: AdminMediaItem
  categories: Array<{ id: number, name: string }>
  saving: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ submit: [fields: {
  title: string, description: string, categoryId: number | null,
  youtubeVideoId?: string, status: 'draft' | 'published' | 'archived',
  commentsEnabled: boolean, isFeatured: boolean,
}] }>()

// Seed once: status polling in the parent must never replace unsaved edits.
const title = ref(props.item?.title ?? '')
const description = ref(props.item?.description ?? '')
const categoryId = ref<number | null>(props.item?.categoryId ?? null)
const youtubeVideoId = ref(props.item?.youtubeVideoId ?? '')
const status = ref<'draft' | 'published' | 'archived'>(props.item?.status ?? 'draft')
const commentsEnabled = ref(props.item?.commentsEnabled ?? false)
const isFeatured = ref(props.item?.isFeatured ?? false)
const isExternal = computed(() => !props.item || props.item.source === 'youtube')
const isProcessing = computed(() => props.item?.processingStatus === 'pending' || props.item?.processingStatus === 'processing')

function submit() {
  if (props.saving || props.disabled) return
  emit('submit', {
    title: title.value.trim(), description: description.value, categoryId: categoryId.value,
    ...(isExternal.value ? { youtubeVideoId: youtubeVideoId.value.trim() } : {}),
    status: status.value, commentsEnabled: commentsEnabled.value, isFeatured: isFeatured.value,
  })
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="submit">
    <fieldset :disabled="saving || disabled" class="space-y-5 disabled:opacity-70">
      <div>
        <label for="media-title" class="block text-sm font-semibold text-[#122815] mb-1">Tiêu đề</label>
        <input id="media-title" v-model="title" required maxlength="512" class="w-full rounded-lg border border-[#e2ece3] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" />
      </div>
      <div v-if="isExternal">
        <label for="media-youtube" class="block text-sm font-semibold text-[#122815] mb-1">Liên kết YouTube hoặc mã video</label>
        <input id="media-youtube" v-model="youtubeVideoId" required maxlength="2048" autocomplete="off" class="w-full rounded-lg border border-[#e2ece3] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" />
      </div>
      <div>
        <label for="media-description" class="block text-sm font-semibold text-[#122815] mb-1">Mô tả</label>
        <textarea id="media-description" v-model="description" rows="5" maxlength="5000" class="w-full rounded-lg border border-[#e2ece3] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" />
      </div>
      <div>
        <label for="media-category" class="block text-sm font-semibold text-[#122815] mb-1">Danh mục</label>
        <select id="media-category" v-model="categoryId" class="w-full rounded-lg border border-[#e2ece3] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]">
          <option :value="null">Không chọn danh mục</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
        <p v-if="!categories.length" class="mt-1 text-sm text-[#667768]">Chưa có danh mục. Có thể lưu video mà không chọn danh mục.</p>
      </div>
      <template v-if="item">
        <div>
          <label for="media-status" class="block text-sm font-semibold text-[#122815] mb-1">Trạng thái xuất bản</label>
          <select id="media-status" v-model="status" class="w-full rounded-lg border border-[#e2ece3] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]">
            <option value="draft">Bản nháp</option>
            <option value="published">Đã xuất bản</option>
            <option value="archived">Đã lưu trữ</option>
          </select>
          <p v-if="isProcessing" class="mt-1 text-sm text-[#667768]">Có thể xuất bản trong khi xử lý. Video bắt đầu phát khi có bản chất lượng đầu tiên; các bản còn lại được bổ sung sau.</p>
        </div>
        <label class="flex items-center gap-2 text-sm"><input v-model="commentsEnabled" type="checkbox" class="h-4 w-4 accent-[#2c6e33]" /> Cho phép bình luận</label>
        <label class="flex items-center gap-2 text-sm"><input v-model="isFeatured" type="checkbox" class="h-4 w-4 accent-[#2c6e33]" /> Video nổi bật</label>
      </template>
      <button type="submit" class="rounded-lg bg-[#2c6e33] px-4 py-2.5 font-semibold text-white hover:bg-[#245b2a] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 disabled:opacity-50">
        {{ saving ? 'Đang lưu…' : item ? 'Lưu thay đổi' : 'Tạo bản nháp' }}
      </button>
    </fieldset>
  </form>
</template>

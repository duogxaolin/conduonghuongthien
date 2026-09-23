<script setup lang="ts">
import type { AdminMediaItem } from '~/types/admin-api'
import { errorMessage } from '~/utils/errorMessage'

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

// ─── oEmbed auto-get metadata ──────────────────────────────────────────────
// Cán bộ dán link YouTube → bấm "Lấy thông tin" → form tự điền tiêu đề + hiện
// preview thumbnail/tác giả. Tiêu đề chỉ điền khi đang rỗng — không ghi đè tiêu
// đề VN hoá cán bộ đã tự gõ.
const fetchingMeta = ref(false)
const metaError = ref('')
const previewTitle = ref('')
const previewAuthor = ref('')
const previewThumb = ref('')

async function fetchMeta() {
  if (!youtubeVideoId.value.trim() || fetchingMeta.value) return
  fetchingMeta.value = true
  metaError.value = ''
  try {
    const res = await $fetch<{ ok: boolean, reason?: string, title?: string, authorName?: string, thumbnailUrl?: string, videoId?: string }>(
      '/api/admin/media-portal/youtube-meta',
      { method: 'POST', body: { url: youtubeVideoId.value.trim() } },
    )
    if (!res.ok) {
      metaError.value = res.reason === 'invalid'
        ? 'Địa chỉ video không hợp lệ hoặc không được hỗ trợ.'
        : 'Không lấy được thông tin từ YouTube. Kiểm tra lại liên kết hoặc thử lại.'
      previewTitle.value = ''
      previewAuthor.value = ''
      previewThumb.value = ''
      return
    }
    // Chỉ điền tiêu đề khi đang rỗng — không ghi đè tiêu đề cán bộ đã tự gõ.
    if (!title.value.trim() && res.title) title.value = res.title
    previewTitle.value = res.title ?? ''
    previewAuthor.value = res.authorName ?? ''
    previewThumb.value = res.thumbnailUrl ?? ''
    // Chuẩn hoá thẳng từ URL sang ID — tránh paste lại.
    if (res.videoId) youtubeVideoId.value = res.videoId
  } catch (err: unknown) {
    metaError.value = errorMessage(err, 'Không lấy được thông tin từ YouTube.')
    previewTitle.value = ''
    previewAuthor.value = ''
    previewThumb.value = ''
  } finally {
    fetchingMeta.value = false
  }
}

/** Blur trên ô link → tự fetch nếu có giá trị. Không fetch trên mỗi keystroke để
 *  tránh spam YouTube. */
function maybeFetchMeta() {
  if (youtubeVideoId.value.trim() && !previewThumb.value) fetchMeta()
}

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
        <div class="flex gap-2">
          <input
            id="media-youtube"
            v-model="youtubeVideoId"
            required
            maxlength="2048"
            autocomplete="off"
            class="flex-1 rounded-lg border border-[#e2ece3] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
            @blur="maybeFetchMeta"
          />
          <button
            type="button"
            :disabled="fetchingMeta || !youtubeVideoId.trim()"
            class="shrink-0 rounded-lg bg-[#e8f0e8] px-3 py-2 text-sm font-semibold text-[#2c6e33] hover:bg-[#d4e6d4] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 border border-[#cce5cd]"
            @click="fetchMeta"
          >
            <i class="fa-solid fa-cloud-arrow-down text-xs" aria-hidden="true"></i>
            <span>{{ fetchingMeta ? 'Đang lấy…' : 'Lấy thông tin' }}</span>
          </button>
        </div>
        <p v-if="metaError" role="alert" class="mt-1.5 text-sm text-[#a32924]">{{ metaError }}</p>
        <!-- Preview metadata đã lấy -->
        <div v-if="previewThumb" class="mt-2 flex gap-3 rounded-lg border border-[#e2ece3] bg-[#f8faf7] p-3">
          <img
            :src="previewThumb"
            :alt="previewTitle"
            loading="lazy"
            class="w-32 aspect-video object-cover rounded shrink-0"
          />
          <div class="flex flex-col gap-1 min-w-0">
            <span class="text-sm font-bold text-[#1e251c] line-clamp-2">{{ previewTitle }}</span>
            <span v-if="previewAuthor" class="text-xs text-[#667768]">
              <i class="fa-regular fa-circle-user mr-1" aria-hidden="true"></i>{{ previewAuthor }}
            </span>
            <span class="text-[0.72rem] text-[#4A6741] font-semibold mt-auto">
              <i class="fa-solid fa-check mr-1" aria-hidden="true"></i>Đã điền tiêu đề
            </span>
          </div>
        </div>
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

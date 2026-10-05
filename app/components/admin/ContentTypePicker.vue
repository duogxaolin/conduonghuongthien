<script setup lang="ts">
import { ref, onMounted } from 'vue'

/**
 * Dialog picker chọn một Content-Type để thêm nhanh vào menu navbar/mobile.
 * Chọn xong → emit `pick` với { label, url, icon } — caller tự push vào menu.
 *
 * Dùng `/api/public/content-types` (công khai, không cần auth) để cả trang navbar
 * (quyền `settings.update`) lẫn mobile đều gọi được.
 */
const emit = defineEmits<{
  (e: 'pick', value: { slug: string; name: string; url: string; icon: string | null }): void
  (e: 'close'): void
}>()

interface PublicContentType {
  slug: string
  name: string
  icon: string | null
  description: string | null
}

const items = ref<PublicContentType[]>([])
const loading = ref(true)
const selectedSlug = ref('')
const error = ref('')

const fetchTypes = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicContentType[] }>)('/api/public/content-types')
    if (res.ok) {
      items.value = res.items
      if (items.value.length) selectedSlug.value = items.value[0]!.slug
    } else {
      error.value = 'Không tải được danh sách thể loại.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được danh sách thể loại.')
  } finally {
    loading.value = false
  }
}

const confirm = () => {
  const ct = items.value.find((t) => t.slug === selectedSlug.value)
  if (!ct) return
  emit('pick', { slug: ct.slug, name: ct.name, url: `/${ct.slug}`, icon: ct.icon })
  emit('close')
}

onMounted(fetchTypes)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="true" class="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="$emit('close')" />
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-[440px] overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#e2ece3] bg-[#f8faf8]">
            <h2 class="text-[1.05rem] font-extrabold text-[#122815] m-0">
              <i class="fa-solid fa-sitemap text-[#2c6e33] mr-2"></i>
              Chọn Thể loại
            </h2>
            <button type="button" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#e2ece3] cursor-pointer border-0 bg-transparent text-[#667768]" @click="$emit('close')" aria-label="Đóng">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <!-- Body -->
          <div class="px-6 py-5 flex flex-col gap-3">
            <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-2">
              <span class="sr-only">Đang tải danh sách thể loại</span>
              <div v-for="n in 4" :key="n" class="h-10 bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none" aria-hidden="true"></div>
            </div>

            <div v-else-if="error" role="alert" class="text-sm text-[#B04A4A] flex items-center gap-2">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              {{ error }}
              <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchTypes">Thử lại</button>
            </div>

            <select
              v-else
              v-model="selectedSlug"
              aria-label="Chọn thể loại để thêm vào menu"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
            >
              <option v-for="ct in items" :key="ct.slug" :value="ct.slug">{{ ct.name }}</option>
            </select>

            <p v-if="!loading && !error" class="text-[0.78rem] text-[#667768] m-0">
              <i class="fa-solid fa-circle-info text-[#2c6e33] mr-1" aria-hidden="true"></i>
              URL sẽ tự điền <code class="bg-[#f4f7f4] px-1.5 py-0.5 rounded text-[0.72rem]">/{{ '{' }}slug{{ '}' }}</code> — vẫn sửa tay được sau khi thêm.
            </p>
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-[#e2ece3] flex justify-end gap-3">
            <button type="button" class="px-4 py-2 rounded-lg border border-[#c8d6c9] bg-white text-[#667768] font-semibold text-sm cursor-pointer hover:bg-[#f8faf8] transition-colors" @click="$emit('close')">
              Hủy
            </button>
            <button type="button" class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2 rounded-lg cursor-pointer border-0 transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm" :disabled="loading || !selectedSlug" @click="confirm">
              <i class="fa-solid fa-plus"></i>
              Thêm vào menu
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>

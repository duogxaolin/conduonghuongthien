<script setup lang="ts">
import type { AdminMediaConfig } from '~/types/admin-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const { hasPermission } = useAdminAuth()
const canCreate = computed(() => hasPermission('media_portal', 'create'))
const config = ref<AdminMediaConfig | null>(null)
const loading = ref(true)
const loadError = ref('')
const saveError = ref('')
const saving = ref(false)
const created = ref(false)
const toast = useToast()

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    if (canCreate.value) config.value = await $fetch('/api/admin/media-portal/config')
  } catch {
    loadError.value = 'Không tải được thông tin biểu mẫu.'
  } finally { loading.value = false }
}
async function save(fields: { title: string, description: string, categoryId: number | null, youtubeVideoId?: string }) {
  if (!canCreate.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    const result = await $fetch('/api/admin/media-portal/external', { method: 'POST', body: fields, retry: 0 })
    created.value = true
    toast.success('Đã tạo bản nháp video.')
    if (hasPermission('media_portal', 'read')) await navigateTo(`/admin/media-portal/${result.id}`)
  } catch (error) { saveError.value = errorMessage(error, 'Không tạo được video. Kiểm tra thông tin rồi thử lại.') }
  finally { saving.value = false }
}
onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <NuxtLink to="/admin/media-portal" class="text-sm text-[#2c6e33] underline">Quay lại thư viện video</NuxtLink>
    <h1 class="text-xl font-extrabold text-[#122815]">Đăng video YouTube</h1>
    <p class="text-sm text-[#667768]">Video được lưu thành bản nháp. Có thể kiểm tra và xuất bản ở bước tiếp theo.</p>
    <div v-if="loading" role="status" aria-busy="true"><span class="sr-only">Đang tải biểu mẫu</span><SkeletonForm label="Đang tải biểu mẫu" :fields="4" /></div>
    <div v-else-if="loadError" role="alert" class="rounded-lg bg-red-50 p-4 text-red-800">{{ loadError }} <button class="font-semibold underline" @click="load()">Thử lại</button></div>
    <p v-else-if="!canCreate" role="alert" class="rounded-lg bg-amber-50 p-4">Bạn chưa được cấp quyền tạo video.</p>
    <p v-else-if="created" role="status" class="rounded-lg bg-green-50 p-4">Đã tạo bản nháp video.</p>
    <div v-else-if="config" class="rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-6">
      <p v-if="saveError" role="alert" class="mb-4 text-red-800">{{ saveError }}</p>
      <AdminMediaPortalForm :categories="config.categories" :saving="saving" @submit="save" />
    </div>
  </div>
</template>

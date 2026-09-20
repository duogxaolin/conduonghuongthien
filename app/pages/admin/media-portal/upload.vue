<script setup lang="ts">
import type { AdminMediaConfig } from '~/types/admin-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const { hasPermission } = useAdminAuth()
const canUpload = computed(() => hasPermission('media_portal', 'create') && hasPermission('media_portal', 'read'))
const config = ref<AdminMediaConfig | null>(null)
const loading = ref(true)
const loadError = ref('')
async function load() {
  loading.value = true
  loadError.value = ''
  try { if (canUpload.value) config.value = await $fetch('/api/admin/media-portal/config') }
  catch { loadError.value = 'Không kiểm tra được khả năng tải video của máy chủ.' }
  finally { loading.value = false }
}
function uploaded(result: { mediaItemId: number }) { return navigateTo(`/admin/media-portal/${result.mediaItemId}`) }
function close() { return navigateTo('/admin/media-portal') }
onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <NuxtLink to="/admin/media-portal" class="text-sm text-[#2c6e33] underline">Quay lại thư viện video</NuxtLink>
    <h1 class="text-xl font-extrabold text-[#122815]">Tải video lên</h1>
    <div v-if="loading" role="status" aria-busy="true"><span class="sr-only">Đang kiểm tra khả năng tải lên</span><SkeletonForm label="Đang kiểm tra khả năng tải lên" :fields="1" /></div>
    <div v-else-if="loadError" role="alert" class="rounded-lg bg-red-50 p-4 text-red-800">{{ loadError }} <button class="font-semibold underline" @click="load()">Thử lại</button></div>
    <p v-else-if="!canUpload" role="alert" class="rounded-lg bg-amber-50 p-4">Bạn cần quyền tạo và xem video để tải lên và theo dõi tiến độ.</p>
    <p v-else-if="!config?.uploadEnabled" role="status" class="rounded-lg bg-amber-50 p-4">Máy chủ hiện chưa bật tải video. Bạn vẫn có thể đăng video YouTube.</p>
    <AdminChunkedUploader v-else :open="true" :max-upload-size="config.maxUploadSize" @uploaded="uploaded" @close="close" />
  </div>
</template>

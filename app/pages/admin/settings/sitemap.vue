<script setup lang="ts">
import { errorMessage } from '~/utils/errorMessage'
import type { SitemapGenerateResponse, SitemapResponse, SitemapSaveResponse } from '~/types/admin-settings-api'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const loading = ref(true)
const saving = ref(false)
const generating = ref(false)
const error = ref('')
const xml = ref('')
const updatedAt = ref<string | null>(null)
const hasSaved = ref(false)
const toast = useToast()
const { confirm } = useConfirm()

const fetchSitemap = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await adminFetch<SitemapResponse>(`/api/admin/settings/sitemap`)
    if (res.ok) {
      xml.value = res.xml ?? res.generated
      hasSaved.value = res.xml !== null
      updatedAt.value = res.updatedAt
    } else {
      error.value = 'Không tải được sitemap.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được sitemap.')
  } finally {
    loading.value = false
  }
}

const handleGenerate = async () => {
  if (hasSaved.value) {
    const ok = await confirm({
      message: 'Sinh lại sẽ ghi đè phần bạn đã sửa trong ô dưới đây. Tiếp tục?',
      confirmLabel: 'Sinh lại',
      danger: true,
    })
    if (!ok) return
  }
  generating.value = true
  try {
    const res = await adminFetch<SitemapGenerateResponse>(`/api/admin/settings/sitemap/generate`, { method: 'POST' })
    if (res.ok) xml.value = res.xml
    toast.success('Đã sinh sitemap từ dữ liệu hiện tại. Bấm "Lưu" để áp dụng.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không sinh được sitemap.'))
  } finally {
    generating.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  try {
    const res = await adminFetch<SitemapSaveResponse>(`/api/admin/settings/sitemap`, {
      method: 'PUT',
      body: { xml: xml.value },
    })
    if (res.ok) {
      hasSaved.value = true
      updatedAt.value = res.updatedAt
      toast.success('Đã lưu sitemap.')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu sitemap.'))
  } finally {
    saving.value = false
  }
}

const formatDate = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('vi-VN')
}

onMounted(() => { fetchSitemap() })
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-brand-600">Sitemap</h1>
        <p class="mt-1 text-sm text-gray-500">
          Sinh sitemap từ dữ liệu trang + bài viết đã xuất bản, sửa trực tiếp nếu cần, rồi lưu.
          Bản đã lưu là bản phục vụ tại <code class="rounded bg-gray-100 px-1">/sitemap.xml</code>.
        </p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-xl border border-brand-600/30 px-4 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-600/5 disabled:opacity-50"
          :disabled="generating || loading"
          @click="handleGenerate"
        >
          <i class="fa-solid fa-rotate mr-1.5" :class="{ 'fa-spin': generating }" />
          {{ hasSaved ? 'Sinh lại' : 'Sinh sitemap' }}
        </button>
        <button
          type="button"
          class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#3c5438] disabled:opacity-50"
          :disabled="saving || loading || !xml.trim()"
          @click="handleSave"
        >
          <i class="fa-solid fa-floppy-disk mr-1.5" />
          Lưu
        </button>
      </div>
    </div>

    <div v-if="updatedAt" class="mb-3 text-sm text-gray-500">
      <i class="fa-regular fa-clock mr-1" />
      Lần lưu cuối: {{ formatDate(updatedAt) }}
    </div>

    <textarea
      v-if="!loading && !error"
      v-model="xml"
      rows="24"
      spellcheck="false"
      class="w-full rounded-xl border border-gray-300 p-3 font-mono text-sm text-gray-800 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      placeholder="<?xml version=&quot;1.0&quot; encoding=&quot;UTF-8&quot;?>&#10;<urlset xmlns=&quot;http://www.sitemaps.org/schemas/sitemap/0.9&quot;>..."
    />

    <div v-if="loading" role="status" aria-busy="true" class="space-y-3">
      <span class="sr-only">Đang tải sitemap...</span>
      <div class="h-10 w-2/3 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" aria-hidden="true" />
      <div class="h-10 w-full animate-pulse rounded bg-gray-200 motion-reduce:animate-none" aria-hidden="true" />
      <div class="h-10 w-full animate-pulse rounded bg-gray-200 motion-reduce:animate-none" aria-hidden="true" />
    </div>

    <div
      v-else-if="error"
      role="alert"
      class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
    >
      {{ error }}
      Vui lòng
      <button type="button" class="font-bold underline" @click="fetchSitemap()">thử lại</button>.
    </div>
  </div>
</template>

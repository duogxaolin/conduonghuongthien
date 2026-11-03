<script setup lang="ts">
import { DOC_PREVIEWS, type PreviewHotspot } from '~/utils/docs/previews'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const toast = useToast()

const pageSlug = computed(() => route.params.pageSlug as string)
const preview = computed(() => DOC_PREVIEWS.find(p => p.slug === pageSlug.value))

// Redirect if preview not found
if (!preview.value) {
  toast.error('Không tìm thấy trang xem trước')
  await navigateTo('/admin/docs')
}

const handleHotspotClick = (docSlug: string, anchor?: string) => {
  const target = anchor ? `/admin/docs/${docSlug}#${anchor}` : `/admin/docs/${docSlug}`
  navigateTo(target)
}
</script>

<template>
  <div v-if="preview" class="flex flex-col gap-5">
    <!-- Back link -->
    <NuxtLink to="/admin/docs" class="inline-flex items-center gap-2 text-[0.82rem] font-semibold text-brand-700 hover:underline w-fit">
      <i class="fa-solid fa-arrow-left text-xs" aria-hidden="true"></i>
      Tài liệu hệ thống
    </NuxtLink>

    <!-- Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">{{ preview.title }}</h1>
      <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Click vào vùng muốn sửa — hệ thống sẽ mở tài liệu hướng dẫn cho vùng đó.</p>
    </div>

    <!-- Description -->
    <p class="text-[0.88rem] text-[#425845] m-0 leading-relaxed">{{ preview.description }}</p>

    <!-- Skeleton preview -->
    <p class="text-[0.78rem] text-ink-muted m-0 italic">
      <i class="fa-solid fa-hand-pointer mr-1.5" aria-hidden="true"></i>
      Bấm vào vùng được đánh dấu để xem tài liệu
    </p>
    <AdminDocsPreviewSkeleton :layout="preview.layout" :hotspots="preview.hotspots" @hotspot-click="handleHotspotClick" />
  </div>
</template>

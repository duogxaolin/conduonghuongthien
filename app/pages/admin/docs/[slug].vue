<script setup lang="ts">
import { ADMIN_DOCS, ADMIN_DOC_CATEGORIES, findDocBySlug } from '~/utils/docs/admin-docs-index'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const toast = useToast()

const slug = computed(() => route.params.slug as string)
const doc = computed(() => findDocBySlug(slug.value))

// Redirect if doc not found
if (!doc.value) {
  toast.error('Không tìm thấy tài liệu')
  await navigateTo('/admin/docs')
}

const categoryMeta = computed(() =>
  ADMIN_DOC_CATEGORIES.find(c => c.key === doc.value?.category),
)

// Related docs (same category, excluding current)
const relatedDocs = computed(() =>
  doc.value
    ? ADMIN_DOCS.filter(d => d.category === doc.value!.category && d.slug !== doc.value!.slug).slice(0, 4)
    : [],
)

// Anchor scroll
onMounted(() => {
  if (route.hash) {
    const element = document.querySelector(route.hash)
    if (element) element.scrollIntoView({ behavior: 'smooth' })
  }
})
</script>

<template>
  <div v-if="doc" class="flex flex-col gap-6">
    <!-- Back link -->
    <NuxtLink to="/admin/docs" class="inline-flex items-center gap-2 text-[0.82rem] font-semibold text-[#2c6e33] hover:underline w-fit">
      <i class="fa-solid fa-arrow-left text-xs" aria-hidden="true"></i>
      Tài liệu hệ thống
    </NuxtLink>

    <!-- Title section -->
    <div>
      <div class="flex items-center gap-3 mb-2">
        <div class="w-12 h-12 rounded-xl bg-[#f0f7f1] flex items-center justify-center text-[#2c6e33]">
          <i :class="doc.icon" class="text-xl" aria-hidden="true"></i>
        </div>
        <div>
          <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">{{ doc.title }}</h1>
          <span
            v-if="categoryMeta"
            class="inline-flex items-center gap-1 text-[0.72rem] font-semibold text-[#2c6e33] bg-[#f0f7f1] px-2.5 py-0.5 rounded-full"
          >
            <i :class="categoryMeta.icon" class="text-[0.6rem]" aria-hidden="true"></i>
            {{ categoryMeta.label }}
          </span>
        </div>
      </div>
      <p class="text-[0.88rem] text-[#425845] m-0 leading-relaxed mt-3">{{ doc.description }}</p>
    </div>

    <!-- Screenshot -->
    <div v-if="doc.screenshot" class="bg-white rounded-xl border border-[#e2ece3] p-5">
      <h2 class="text-[0.95rem] font-bold text-[#122815] m-0 mb-3">Hình ảnh minh họa</h2>
      <div class="relative rounded-lg overflow-hidden border border-[#e2ece3]">
        <img
          :src="doc.screenshot"
          :alt="doc.title"
          class="w-full h-auto block"
        >
        <template v-if="doc.highlightRegions">
          <div
            v-for="(region, i) in doc.highlightRegions"
            :key="i"
            class="absolute border-2 border-green-500/70 rounded-md pointer-events-none"
            :style="{
              left: region.x + '%',
              top: region.y + '%',
              width: region.w + '%',
              height: region.h + '%',
            }"
          >
            <span class="absolute -top-6 left-0 bg-green-500 text-white text-[0.65rem] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
              {{ region.label }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- Mermaid diagram -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-5">
      <h2 class="text-[0.95rem] font-bold text-[#122815] m-0 mb-3">Sơ đồ quy trình</h2>
      <AdminDocsMermaidDiagram :source="doc.mermaid" />
    </div>

    <!-- Workflow steps -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-5">
      <h2 class="text-[0.95rem] font-bold text-[#122815] m-0 mb-4">Các bước thực hiện</h2>
      <AdminDocsWorkflowSteps :steps="doc.workflow" />
    </div>

    <!-- Related links -->
    <div v-if="doc.links && doc.links.length > 0" class="bg-white rounded-xl border border-[#e2ece3] p-5">
      <h2 class="text-[0.95rem] font-bold text-[#122815] m-0 mb-3">Trang liên quan</h2>
      <div class="flex flex-wrap gap-2">
        <NuxtLink
          v-for="link in doc.links"
          :key="link.href"
          :to="link.href"
          class="inline-flex items-center gap-1.5 px-3 py-2 bg-[#f0f7f1] border border-[#e2ede3] rounded-lg text-[0.8rem] font-semibold text-[#2c6e33] hover:border-[#2c6e33] hover:bg-[#eaf4ea] transition-colors no-underline"
        >
          <i class="fa-solid fa-link text-[0.65rem]" aria-hidden="true"></i>
          {{ link.label }}
        </NuxtLink>
      </div>
    </div>

    <!-- Related docs -->
    <div v-if="relatedDocs.length > 0">
      <h2 class="text-[0.95rem] font-bold text-[#122815] m-0 mb-3">Tài liệu liên quan</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AdminDocsCard v-for="d in relatedDocs" :key="d.slug" :doc="d" />
      </div>
    </div>
  </div>
</template>

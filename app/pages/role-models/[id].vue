<template>
  <div class="py-10 bg-[#F8FAF7]">
    <div class="max-w-[800px] mx-auto px-4">
      <!-- Breadcrumb -->
      <div class="text-[0.85rem] text-[#7A8675] mb-6">
        <nuxt-link to="/" class="text-[#4A6741] no-underline hover:underline">Trang chủ</nuxt-link> &raquo;
        <nuxt-link to="/role-models" class="text-[#4A6741] no-underline hover:underline">Tấm gương tiêu biểu</nuxt-link> &raquo;
        <span>Chi tiết câu chuyện</span>
      </div>

      <!-- Loading -->
      <div v-if="pending" class="animate-pulse flex flex-col gap-5">
        <div class="h-5 w-40 bg-[#EEF2EC] rounded"></div>
        <div class="h-9 w-3/4 bg-[#EEF2EC] rounded"></div>
        <div class="h-24 w-full bg-[#EEF2EC] rounded"></div>
        <div class="h-64 w-full bg-[#EEF2EC] rounded-lg"></div>
      </div>

      <!-- Main Content -->
      <article v-else-if="article">
        <span class="text-[0.85rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-3 py-1.5 rounded inline-block mb-4">
          📍 {{ article.categoryName || 'Tấm gương tiêu biểu' }} • Ngày đăng: {{ formattedDate }}
        </span>
        <h1 class="text-[2.2rem] font-extrabold leading-[1.3] text-[#1E251C] mb-5">{{ article.title }}</h1>

        <div v-if="article.excerpt" class="text-[1.15rem] font-semibold text-[#4A5545] leading-[1.6] border-l-4 border-[#7CB342] pl-5 mb-8">
          <p>{{ article.excerpt }}</p>
        </div>

        <div class="article-body">
          <div class="my-8 text-center" v-if="article.thumbnailUrl">
            <img :src="article.thumbnailUrl" :alt="article.title" class="w-full max-h-[450px] object-cover rounded-md shadow-sm" />
          </div>

          <div v-html="article.content"></div>
        </div>

        <!-- Back Link -->
        <div class="mt-10 border-t border-[#E2E8DF] pt-8">
          <nuxt-link to="/role-models" class="btn btn-primary">&larr; Quay lại danh sách tấm gương</nuxt-link>
        </div>
      </article>

      <!-- Not found -->
      <div v-else class="py-10 text-center">
        <p class="text-[#4A5545] mb-4">Không tìm thấy bài viết yêu cầu hoặc bài viết đang được cập nhật.</p>
        <nuxt-link to="/role-models" class="btn btn-primary">Quay lại danh sách</nuxt-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const slug = route.params.id

const { data, pending } = await useFetch(`/api/public/articles/${slug}`, {
  default: () => ({ ok: false, article: null }),
})
const article = computed(() => data.value?.article || null)

const formattedDate = computed(() => {
  const a = article.value
  if (!a) return ''
  const raw = a.publishedAt || a.createdAt
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
})

useSeoMeta({
  title: computed(() => article.value ? `${article.value.title} | Con Đường Hướng Thiện` : 'Tấm gương tiêu biểu | Con Đường Hướng Thiện'),
  description: computed(() => article.value?.excerpt || 'Câu chuyện hoàn lương lập nghiệp tiêu biểu.'),
})
</script>

<style scoped>
.article-body :deep(p) { font-size: 1.05rem; line-height: 1.7; color: #4A5545; margin-bottom: 20px; }
.article-body :deep(blockquote) { background-color: #F8FAF7; border-left: 4px solid #4A6741; padding: 20px 24px; margin: 30px 0; font-style: italic; font-size: 1.1rem; color: #385130; }
.article-body :deep(blockquote span) { display: block; font-size: 0.85rem; color: #7A8675; margin-top: 8px; font-weight: 700; font-style: normal; }
</style>

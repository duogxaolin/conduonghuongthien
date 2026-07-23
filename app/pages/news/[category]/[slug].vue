<template>
  <div class="py-10 bg-[#F8FAF7]">
    <div class="max-w-[800px] mx-auto px-4">
      <div class="text-[0.85rem] text-[#7A8675] mb-6">
        <nuxt-link to="/" class="text-[#4A6741] no-underline hover:underline">Trang chủ</nuxt-link> &raquo;
        <nuxt-link to="/news" class="text-[#4A6741] no-underline hover:underline">Bản tin</nuxt-link> &raquo;
        <nuxt-link :to="`/news?category=${route.params.category}`" class="text-[#4A6741] no-underline hover:underline">{{ categoryLabel }}</nuxt-link> &raquo;
        <span>Chi tiết</span>
      </div>

      <article v-if="article">
        <span class="text-[0.85rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-3 py-1.5 rounded inline-block mb-4">
          📰 {{ categoryLabel }} • Ngày đăng: {{ article.date }}
        </span>
        <h1 class="text-[2.2rem] font-extrabold leading-[1.3] text-[#1E251C] mb-5">{{ article.title }}</h1>

        <div class="text-[1.12rem] font-semibold text-[#4A5545] leading-[1.6] border-l-4 border-[#7CB342] pl-5 mb-8">
          <p>{{ article.lead }}</p>
        </div>

        <div class="article-body text-[1.05rem] leading-[1.7] text-[#4A5545]">
          <div class="my-8 text-center" v-if="article.image">
            <img :src="article.image" :alt="article.title" class="w-full max-h-[450px] object-cover rounded-lg shadow-sm" />
          </div>
          <div v-html="article.content"></div>
        </div>

        <div class="mt-10 border-t border-[#E2E8DF] pt-8">
          <nuxt-link to="/news" class="btn btn-primary">&larr; Quay lại Bản tin</nuxt-link>
        </div>
      </article>

      <div v-else-if="!pending" class="py-10 text-center">
        <p class="text-[#4A5545] mb-4">Không tìm thấy bài viết yêu cầu.</p>
        <nuxt-link to="/news" class="btn btn-primary">Quay lại Bản tin</nuxt-link>
      </div>
    </div>
  </div>
</template>

<script setup>
const route = useRoute()

const categoryLabels = {
  'tin-noi-bat':    'Tin nổi bật',
  'tin-hoat-dong':  'Tin hoạt động',
  'tin-dia-phuong': 'Tin địa phương',
  'tin-moi-nhat':   'Tin mới nhất',
}

const categoryLabel = computed(() => categoryLabels[route.params.category] || route.params.category)

const article = ref(null)
const pending = ref(true)

onMounted(async () => {
  try {
    const res = await $fetch(`/api/public/articles/${route.params.slug}`)
    if (res.ok && res.article) {
      article.value = {
        date:    new Date(res.article.publishedAt || res.article.createdAt).toLocaleDateString('vi-VN'),
        title:   res.article.title,
        image:   res.article.thumbnailUrl || null,
        lead:    res.article.excerpt || '',
        content: res.article.content || '',
      }
    }
  } catch { /* 404 — show not found */ } finally {
    pending.value = false
  }
})
</script>

<style scoped>
.article-body :deep(p) { font-size: 1.05rem; line-height: 1.7; color: #4A5545; margin-bottom: 20px; }
.article-body :deep(blockquote) { background-color: #F8FAF7; border-left: 4px solid #4A6741; padding: 20px 24px; margin: 30px 0; font-style: italic; font-size: 1.1rem; color: #385130; }
.article-body :deep(blockquote span) { display: block; font-size: 0.85rem; color: #7A8675; margin-top: 8px; font-weight: 700; font-style: normal; }
</style>

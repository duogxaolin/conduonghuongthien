<template>
  <!--
    Trang in bài — layout báo giấy, KHÔNG dùng default layout (không nav/sidebar/
    chat/footer). Tự fetch bài + site settings, render kiểu báo, tự gọi window.print()
    phía client sau khi mounted. noindex để không lọt chỉ mục tìm kiếm.
    Tuyến này chỉ phục vụ nút "In bài" ở ArticleDetail — không liên kết từ đâu khác.
  -->
  <div class="print-page">
    <!-- Loading -->
    <div v-if="pending" class="print-loading" role="status" aria-busy="true">
      <p>Đang tải bài viết để in…</p>
    </div>

    <!-- Lỗi tải -->
    <div v-else-if="loadError || !article" class="print-error" role="alert">
      <p>Không thể tải bài viết để in.</p>
      <a :href="`/${backPath}`">Quay lại trang bài viết</a>
    </div>

    <!-- Bố cục báo giấy -->
    <article v-else class="printSheet">
      <!-- Masthead: logo cơ quan chủ quản + tên cổng + ngày xuất bản -->
      <header class="masthead">
        <div class="masthead-row">
          <div v-if="mainLogoUrl || siteLogoUrl" class="masthead-logos">
            <img v-if="mainLogoUrl" :src="mainLogoUrl" alt="Logo cơ quan chủ quản" class="masthead-logo-main" />
            <img v-if="siteLogoUrl" :src="siteLogoUrl" alt="Logo Con Đường Hướng Thiện" class="masthead-logo-portal" />
          </div>
          <div class="masthead-title">
            <h1 class="masthead-name">CON ĐƯỜNG HƯỚNG THIỆN</h1>
            <p class="masthead-sub">{{ t('portal_subtitle') }}</p>
          </div>
          <div class="masthead-meta">
            <p class="masthead-date">{{ publicationDate }}</p>
            <p class="masthead-edition">Bản in</p>
          </div>
        </div>
        <div class="masthead-rule"></div>
      </header>

      <!-- Thân bài -->
      <main class="printBody">
        <p v-if="categoryLabel" class="print-kicker">{{ categoryLabel }}</p>
        <h1 class="print-headline">{{ article.title }}</h1>

        <p v-if="article.excerpt" class="print-standfirst">{{ article.excerpt }}</p>

        <div class="print-byline">
          <span v-if="authorDisplay">{{ authorDisplay }}</span>
          <span v-if="formattedDate" class="print-byline-sep">·</span>
          <span v-if="formattedDate">{{ formattedDate }}</span>
          <span v-if="formattedViews" class="print-byline-sep">·</span>
          <span v-if="formattedViews">{{ formattedViews }} {{ t('a_views_suffix') }}</span>
        </div>

        <div v-if="article.thumbnailUrl" class="print-figure">
          <NuxtImg :src="article.thumbnailUrl" :alt="article.title" loading="lazy" sizes="256px sm:384px" format="webp" class="print-figure-img" />
        </div>

        <!-- eslint-disable-next-line vue/no-v-html -- nội dung do biên tập viên C11 soạn, đã sanitize lúc ghi -->
        <div class="print-article-body" v-html="article.content"></div>
      </main>

      <!-- Footer báo: nguồn + liên hệ + URL -->
      <footer class="printFoot">
        <div class="printFoot-rule"></div>
        <div class="printFoot-row">
          <div class="printFoot-source">
            <strong>Con Đường Hướng Thiện</strong>
            <span v-if="siteAddress"> · {{ siteAddress }}</span>
            <span v-if="siteHotline"> · Đường dây nóng: {{ siteHotline }}</span>
            <span v-if="siteEmail"> · {{ siteEmail }}</span>
          </div>
          <div class="printFoot-url">
            <span>{{ t('a_print_source_url') }}: {{ pageUrl }}</span>
          </div>
        </div>
      </footer>
    </article>
  </div>
</template>

<script setup lang="ts">
/**
 * Trang in bài viết — bản báo giấy.
 *
 * KHÔNG dùng default layout (`layout: false`) để tách biệt hoàn toàn nav/sidebar/
 * chat/footer của cổng. Tự fetch ArticleDetail + site settings, render bố cục báo,
 * tự kích hoạt `window.print()` sau khi mount (client-only). `noindex` để không
 * lọt chỉ mục tìm kiếm. Tuyến chỉ phục vụ nút "In bài" ở `ArticleDetail.vue`.
 */
definePageMeta({ layout: false })

const route = useRoute()
const { currentLang, t } = useI18n()

const slug = computed(() => String(route.params.slug || ''))

// Lùi về trang danh sách bài — heuristic: lấy từ query `back` nếu có, mặc định '/'.
const backPath = computed(() => {
  const q = String(route.query.back || '').trim()
  return q || '/'
})

const pageUrl = computed(() => {
  if (typeof window !== 'undefined') {
    // URL bài gốc — reconstruct từ backPath + slug (bỏ /in-bai/).
    const base = window.location.origin
    const back = backPath.value
    const articleUrl = back === '/' ? `/${slug.value}` : `${back}/${slug.value}`
    return `${base}${articleUrl.startsWith('/') ? articleUrl : '/' + articleUrl}`
  }
  return ''
})

type ArticleDetailResponse = {
  ok: boolean
  article: {
    id: number
    title: string
    slug: string
    excerpt: string | null
    content: string
    featuredImage: string | null
    thumbnailUrl?: string | null
    publishedAt: string | null
    createdAt?: string | null
    type?: string
    categoryName?: string | null
    authorName?: string | null
    viewTotal?: number
    category?: { name: string; slug: string } | null
    [key: string]: unknown
  } | null
}

// SSR fetch để HTML có sẵn khi in — không lazy.
const { data, pending, error } = useAsyncData(
  () => `article-print-${slug.value}-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<ArticleDetailResponse>)(`/api/public/articles/${slug.value}?lang=${currentLang.value}`),
  { watch: [slug, currentLang] },
)

const article = computed(() => data.value?.article || null)
const loadError = computed(() => !!error.value)

// Site settings để masthead/logo + footer liên hệ — chung with default.vue.
type PublicSettingsResponse = { settings?: Record<string, string | null>; faviconUrl?: string | null }
const { data: settingsData } = useAsyncData<PublicSettingsResponse | null>(
  'article-print-settings',
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<PublicSettingsResponse>)('/api/public/settings'),
  { default: () => null },
)
const sitePublicSettings = computed(() => settingsData.value?.settings || {})
const siteLogoUrl = computed(() => {
  const v = sitePublicSettings.value.logo_url
  if (v === '') return ''
  return v?.trim() || '/Logo.png'
})
const mainLogoUrl = computed(() => sitePublicSettings.value.main_logo_url?.trim() || '')
const siteHotline = computed(() => sitePublicSettings.value.hotline?.trim() || '0903.480.985')
const siteEmail = computed(() => sitePublicSettings.value.email?.trim() || 'contact@conduonghuongthien.com.vn')
const siteAddress = computed(() => sitePublicSettings.value.address?.trim() || '')

const categoryLabel = computed(() => article.value?.categoryName || '')
const authorDisplay = computed(() => article.value?.authorName || t('a_author_default'))
const formattedDate = computed(() => {
  const d = article.value?.publishedAt || article.value?.createdAt
  if (!d) return ''
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  const locale = currentLang.value === 'vi' ? 'vi-VN' : currentLang.value === 'en' ? 'en-US' : currentLang.value
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' })
})
const formattedViews = computed(() => {
  if (!article.value?.viewTotal) return ''
  const locale = currentLang.value === 'vi' ? 'vi-VN' : currentLang.value === 'en' ? 'en-US' : currentLang.value
  return Number(article.value.viewTotal).toLocaleString(locale)
})

// Ngày xuất bản masthead — ngày hôm nay (ngày in).
const publicationDate = computed(() => {
  const locale = currentLang.value === 'vi' ? 'vi-VN' : currentLang.value === 'en' ? 'en-US' : currentLang.value
  return new Date().toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
})

// SEO: không index trang in.
useSeoMeta({
  robots: 'noindex, nofollow',
  title: computed(() => (article.value ? `${article.value.title} | Con Đường Hướng Thiện (Bản in)` : 'Con Đường Hướng Thiện')),
})

// Tự kích hoạt hộp in sau khi tải xong (client-only).
onMounted(() => {
  if (typeof window === 'undefined') return
  // Đợi DOM settle + ảnh tải xong nếu có.
  const trigger = () => {
    if (pending.value || loadError.value || !article.value) return
    window.print()
  }
  // Đợi 1 nhịp để content render + ảnh bắt đầu tải; ảnh lớn có thể chậm nên
  // dùngsetTimeout ngắn — in vẫn hoạt động vì ảnh đã trong DOM.
  setTimeout(trigger, 400)
})
</script>

<style scoped>
/* Bố cục báo giấy — dùng CSS thuần (không Tailwind) để kiểm soát chính xác trang in. */
.print-page {
  background: #fff;
  color: #1a1a1a;
  font-family: 'Inter', 'Georgia', 'Times New Roman', serif;
  min-height: 100vh;
}

/* Khổ giấy A4 tối ảo trên nền màn hình — số đo theo mm để khớp khi in thật. */
.printSheet {
  max-width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 18mm 16mm;
  background: #fff;
}

/* Masthead - đầu báo */
.masthead {
  margin-bottom: 1.5rem;
}
.masthead-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.masthead-logos {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.masthead-logo-main {
  height: 48px;
  width: auto;
  object-fit: contain;
}
.masthead-logo-portal {
  height: 36px;
  width: auto;
  object-fit: contain;
}
.masthead-title {
  text-align: center;
  flex: 1;
  min-width: 200px;
}
.masthead-name {
  font-family: 'Inter', sans-serif;
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #4A6741;
  margin: 0;
  line-height: 1.2;
}
.masthead-sub {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #7A8675;
  margin: 0.15rem 0 0;
  letter-spacing: 0.3px;
}
.masthead-meta {
  text-align: right;
  font-size: 0.78rem;
  color: #5C6B55;
}
.masthead-date {
  margin: 0;
  font-weight: 600;
  text-transform: capitalize;
}
.masthead-edition {
  margin: 0.15rem 0 0;
  font-style: italic;
  color: #7A8675;
}
.masthead-rule {
  height: 3px;
  background: #4A6741;
  margin: 0.8rem 0 0;
  border: none;
}

/* Thân bài */
.printBody {
  font-size: 1rem;
  line-height: 1.75;
  color: #1a1a1a;
}
.print-kicker {
  font-family: 'Inter', sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #4A6741;
  margin: 0 0 0.4rem;
}
.print-headline {
  font-family: 'Inter', sans-serif;
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1.2;
  color: #1a1a1a;
  margin: 0 0 0.8rem;
}
.print-standfirst {
  font-size: 1.05rem;
  line-height: 1.55;
  font-weight: 600;
  color: #4A5545;
  border-left: 3px solid #7CB342;
  padding-left: 0.8rem;
  margin: 0 0 1.2rem;
  font-style: italic;
}
.print-byline {
  font-family: 'Inter', sans-serif;
  font-size: 0.82rem;
  color: #5C6B55;
  margin-bottom: 1.5rem;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid #d0ddd1;
}
.print-byline-sep {
  margin: 0 0.4rem;
  color: #a0ad9c;
}
.print-figure {
  text-align: center;
  margin: 1.5rem 0;
}
.print-figure img {
  max-width: 100%;
  height: auto;
  max-height: 320px;
  object-fit: contain;
}

/* Body article — typography serif cho văn phong báo chí. Override v-html rich-text. */
.print-article-body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 1.02rem;
  line-height: 1.78;
  color: #1a1a1a;
}
.print-article-body :deep(p) {
  margin: 0 0 0.9rem;
  text-align: justify;
  text-justify: inter-word;
}
.print-article-body :deep(h2) {
  font-family: 'Inter', sans-serif;
  font-size: 1.35rem;
  font-weight: 700;
  color: #2c3528;
  margin: 1.6rem 0 0.6rem;
  line-height: 1.3;
}
.print-article-body :deep(h3) {
  font-family: 'Inter', sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
  color: #2c3528;
  margin: 1.2rem 0 0.5rem;
  line-height: 1.3;
}
.print-article-body :deep(img),
.print-article-body :deep(video) {
  max-width: 100%;
  height: auto;
}
.print-article-body :deep(figure) {
  margin: 1.2rem 0;
  text-align: center;
}
.print-article-body :deep(figcaption) {
  font-size: 0.8rem;
  color: #7A8675;
  font-style: italic;
  margin-top: 0.4rem;
}
.print-article-body :deep(blockquote) {
  border-left: 3px solid #7CB342;
  padding-left: 1rem;
  margin: 1rem 0;
  font-style: italic;
  color: #4A5545;
}
.print-article-body :deep(ul),
.print-article-body :deep(ol) {
  margin: 0 0 0.9rem;
  padding-left: 1.5rem;
}
.print-article-body :deep(li) {
  margin-bottom: 0.4rem;
}
.print-article-body :deep(a) {
  color: #4A6741;
  text-decoration: underline;
  word-break: break-word;
}
.print-article-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}
.print-article-body :deep(th),
.print-article-body :deep(td) {
  border: 1px solid #d0ddd1;
  padding: 0.5rem;
  text-align: left;
}
.print-article-body :deep(th) {
  background: #f3f7f1;
  font-weight: 700;
}

/* Footer báo */
.printFoot {
  margin-top: 2rem;
}
.printFoot-rule {
  height: 1px;
  background: #4A6741;
  margin-bottom: 0.6rem;
}
.printFoot-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.72rem;
  color: #7A8675;
  flex-wrap: wrap;
}
.printFoot-source strong {
  color: #4A6741;
}
.printFoot-url {
  font-style: italic;
}

/* Lỗi / Tải */
.print-loading,
.print-error {
  max-width: 600px;
  margin: 4rem auto;
  padding: 2rem;
  text-align: center;
  font-family: 'Inter', sans-serif;
  color: #5C6B55;
}
.print-error a {
  color: #4A6741;
  font-weight: 600;
}

/* In: ẩn mọi thứ ngoài sheet, buộc khổ A4. */
@media print {
  @page {
    size: A4;
    margin: 12mm;
  }
  html, body, .print-page {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .printSheet {
    max-width: none;
    margin: 0;
    padding: 0;
    min-height: 0;
    box-shadow: none;
  }
  .print-figure img {
    max-height: none;
  }
}
</style>

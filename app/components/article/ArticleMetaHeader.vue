<!--
  Phần đầu bài trên trang chi tiết: dòng danh mục • ngày đăng • tác giả • lượt xem, tiêu
  đề, sapo, ảnh đại diện.

  Chỉ hiển thị (tách từ ArticleDetail.vue ở wave3 4.2): bài và nhãn danh mục đã phân giải
  vào (ArticleDetail.vue giữ thứ tự ưu tiên của nhãn — badge và breadcrumb không bao giờ
  nói hai điều khác nhau), ngày/lượt xem định dạng theo ngôn ngữ đang chọn ở đây.
-->
<template>
  <span class="text-[0.85rem] font-bold text-brand-600 bg-surface px-3 py-1.5 rounded inline-flex flex-wrap items-center gap-x-2 mb-4">
    <span><i v-if="metaIconIsFa" :class="metaIcon" aria-hidden="true"></i><span v-else aria-hidden="true">{{ metaIcon }}</span> {{ categoryLabel }}</span>
    <span aria-hidden="true">•</span>
    <span><i class="fa-regular fa-calendar" aria-hidden="true"></i> {{ t('a_published_on') }} {{ formattedDate }}</span>
    <span aria-hidden="true">•</span>
    <span><i class="fa-regular fa-user" aria-hidden="true"></i> {{ authorDisplay }}</span>
    <span aria-hidden="true">•</span>
    <span><i class="fa-regular fa-eye" aria-hidden="true"></i> {{ formattedViews }} {{ t('a_views_suffix') }}</span>
  </span>
  <h1 class="text-[1.35rem] sm:text-[1.75rem] lg:text-[2.2rem] font-extrabold leading-[1.3] text-ink mb-4 sm:mb-5">{{ article.title }}</h1>

  <div
    v-if="article.excerpt"
    class="text-[0.95rem] sm:text-[1.12rem] font-semibold text-ink-secondary leading-[1.6] border-l-4 border-accent pl-4 sm:pl-5 mb-6 sm:mb-8"
  >
    <p>{{ article.excerpt }}</p>
  </div>

  <div v-if="article.thumbnailUrl" class="my-8 text-center">
    <SafeImg
      :src="article.thumbnailUrl"
      :alt="article.title" img-class="w-full max-h-[450px] object-cover rounded-lg shadow-sm"
      loading="lazy"
      decoding="async"
      sizes="512px sm:768px lg:1024px"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  article: {
    title: string
    excerpt: string | null
    thumbnailUrl?: string | null
    publishedAt: string | null
    createdAt?: string | null
    authorName?: string | null
    viewTotal?: number
  }
  /** Nhãn danh mục đã phân giải (thứ tự ưu tiên ở ArticleDetail.vue). */
  categoryLabel: string
  /** Biểu tượng trước nhãn: emoji, hoặc class FontAwesome của thể loại tự tạo. */
  metaIcon: string
}>()

const { currentLang, t } = useI18n()

/**
 * `metaIcon` có 2 dạng: emoji (huyến "📰" / "📍" — varian news/role/reintegration)
 * hoặc class FontAwesome ("fa-solid fa-folder" — custom type từ content-types DB).
 * Phân biệt để render đúng: class FA → `<i :class>`, emoji → text. Sai số cũ:
 * custom type hiện literal "fa-solid fa-folder" thay vì icon.
 */
const metaIconIsFa = computed(() => /^fa-(solid|regular|brands|duotone)(\s|$)/.test(String(props.metaIcon).trim()))

const formattedDate = computed(() => {
  const d = props.article.publishedAt || props.article.createdAt
  if (!d) return ''
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  const locale = currentLang.value === 'vi' ? 'vi-VN' : currentLang.value === 'en' ? 'en-US' : currentLang.value
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
})

// Bài viết cũ có thể không còn tác giả (`author_id` nullable, tài khoản đã xoá).
// "Ban biên tập" là chủ thể phát ngôn thật của cổng trong trường hợp đó.
const authorDisplay = computed(() => props.article.authorName || t('a_author_default'))
const formattedViews = computed(() => {
  const locale = currentLang.value === 'vi' ? 'vi-VN' : currentLang.value === 'en' ? 'en-US' : currentLang.value
  return Number(props.article.viewTotal || 0).toLocaleString(locale)
})
</script>

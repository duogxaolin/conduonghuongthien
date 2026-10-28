<!--
  Nội dung của khối "Bài viết khác" khi đã tải xong: danh sách bài + chip chủ đề.

  Chỉ hiển thị (tách từ ArticleDetail.vue ở wave3 4.2). Lượt fetch, khung chờ, nhánh lỗi
  + "thử lại" và điều kiện hiện cả khối ở lại ArticleDetail.vue (hợp đồng tải/lỗi/rỗng).

  Đây là điều hướng phụ, nên nó được trình bày như một DANH SÁCH chứ không
  phải một lưới thẻ: mỗi mục một hàng ngang, ảnh 72×54, không đoạn tóm tắt.
  Bản thẻ trước đó cao gần bằng phần đầu của chính bài đang đọc, và một
  danh sách "đọc gì tiếp" to hơn nội dung nó đứng cạnh sẽ tự nhận lấy sự
  chú ý mà bài viết đáng được nhận.

  Hàng ngang, ảnh nhỏ bên trái, không thẻ và không đoạn tóm tắt.
  Trước đây mỗi mục là một thẻ cao ~250px với ảnh 140px và hai dòng
  mô tả, nên năm bài liên quan chiếm nhiều chiều cao hơn cả phần đầu
  bài đang đọc — một danh sách điều hướng phụ không được phép to hơn
  nội dung nó đứng cạnh. Ảnh giữ lại ở kích thước nhỏ vì nó giúp
  nhận ra bài đã đọc trong nháy mắt; `object-cover` trên khung cố
  định nên ảnh dọc hay ngang đều không phá hàng.
-->
<template>
  <ul v-if="relatedArticles.length" class="list-none m-0 p-0 flex flex-col divide-y divide-line">
    <li v-for="item in relatedArticles" :key="item.id" class="py-3 first:pt-0">
      <nuxt-link
        :to="`${backTo}/${item.slug}`"
        class="group flex items-start gap-3 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded"
      >
        <img
          :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
          alt=""
          loading="lazy"
          decoding="async"
          class="w-[72px] h-[54px] shrink-0 object-cover rounded bg-surface-tint"
        />
        <span class="min-w-0 flex-grow">
          <span class="block text-[0.9rem] font-bold leading-[1.4] text-ink transition-colors duration-200 group-hover:text-brand-600 line-clamp-3">{{ item.title }}</span>
          <span class="block mt-1 text-[0.75rem] text-ink-soft font-semibold">
            {{ formatDateVN(item.publishedAt || item.createdAt) }}
          </span>
        </span>
      </nuxt-link>
    </li>
  </ul>

  <!-- Chủ đề liên quan. Chỉ hiện cho /news vì đó là danh sách duy nhất
       có category filter (path segment `/news/<cat>`); các list hệ thống
       khác (/role-models, /documents, /legal-qa) không có category
       filter nên chip ở đó sẽ mở ra danh sách chưa lọc — trông như bấm hụt. -->
  <div v-if="showTopics" class="mt-7">
    <h3 class="m-0 mb-3 text-[0.95rem] font-extrabold uppercase tracking-wide text-brand-800">
      <i class="fa-solid fa-tags mr-2 text-accent" aria-hidden="true"></i>{{ t('a_topics') }}
    </h3>
    <div class="flex flex-wrap gap-2">
      <nuxt-link
        v-for="topic in relatedTopics"
        :key="topic.slug"
        :to="`${backTo}/${topic.slug}`"
        class="px-3 py-1.5 rounded-full text-[0.85rem] font-semibold border no-underline transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        :class="topic.isCurrent
          ? 'bg-brand-600 border-brand-600 text-white'
          : 'bg-white border-line text-ink-secondary hover:border-accent'"
      >{{ topic.name }} <span class="opacity-70">({{ topic.total }})</span></nuxt-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatDateVN } from '~/utils/formatDate'

defineProps<{
  relatedArticles: Array<{ id: number; title: string; slug: string; thumbnailUrl?: string | null; publishedAt: string | null; createdAt?: string | null }>
  relatedTopics: Array<{ slug: string; name: string; isCurrent?: boolean; total?: number }>
  /** Chip chủ đề chỉ ở nơi cú bấm thật sự lọc được (điều kiện ở ArticleDetail.vue). */
  showTopics: boolean
  /** Tiền tố route của danh sách — link mục là `${backTo}/${slug}`. */
  backTo: string
}>()

const { t } = useI18n()
</script>

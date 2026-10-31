<!--
  Thanh chia sẻ bài viết & in ấn của trang chi tiết bài viết.

  Tách từ ArticleDetail.vue ở wave3 4.2. Không fetch gì: chia sẻ mở cửa sổ của Facebook /
  Zalo với địa chỉ trang đang xem, "Sao chép link" ghi vào bộ nhớ tạm, "In bài" mở trang in
  riêng `/in-bai/<slug>` trong cửa sổ mới. Ẩn khi in (`print:hidden`).

  Màu thương hiệu của Facebook (#1877F2) và Zalo (#0068FF) không phải token của cổng — giữ
  nguyên mã hex (codemod-hex-tokens: unmapped), vào ratchet hex bằng `--raise`.
-->
<template>
  <div class="my-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white p-4 shadow-sm print:hidden">
    <div class="flex items-center gap-2 text-[0.88rem] font-bold text-brand-800">
      <i class="fa-solid fa-share-nodes text-accent" aria-hidden="true"></i>
      <span>{{ t('a_share_label') }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.82rem] font-semibold text-[#1877F2] transition hover:bg-[#1877F2]/10 hover:border-[#1877F2]"
        @click="shareFacebook"
        :title="t('a_share_facebook')"
      >
        <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        {{ t('a_share_facebook') }}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.82rem] font-semibold text-[#0068FF] transition hover:bg-[#0068FF]/10 hover:border-[#0068FF]"
        @click="shareZalo"
        :title="t('a_share_zalo')"
      >
        <i class="fa-solid fa-comment-dots" aria-hidden="true"></i> {{ t('a_share_zalo') }}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.82rem] font-semibold text-brand-600 transition hover:bg-brand-600/10 hover:border-brand-600"
        @click="copyArticleLink"
        :title="copiedArticleLink ? t('a_copied') : t('a_copy_link_btn')"
      >
        <i :class="copiedArticleLink ? 'fa-solid fa-check text-accent' : 'fa-solid fa-link'" aria-hidden="true"></i>
        {{ copiedArticleLink ? t('a_copied') : t('a_copy_link_btn') }}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.82rem] font-semibold text-ink-muted transition hover:bg-ink-muted/10 hover:border-ink-muted"
        @click="printArticle"
        :title="t('a_print_title')"
      >
        <i class="fa-solid fa-print" aria-hidden="true"></i> {{ t('a_print') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  /** Slug của bài — địa chỉ trang in `/in-bai/<slug>`. */
  slug: string
  /** Danh sách để trang in quay về (`?back=`). */
  backTo: string
}>()

const { t } = useI18n()
const toast = useToast()
const copiedArticleLink = ref(false)

const getArticleUrl = () => {
  if (typeof window !== 'undefined') return window.location.href
  return ''
}

const shareFacebook = () => {
  const url = encodeURIComponent(getArticleUrl())
  if (typeof window !== 'undefined') {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener,noreferrer,width=600,height=400')
  }
}

const shareZalo = () => {
  const url = encodeURIComponent(getArticleUrl())
  if (typeof window !== 'undefined') {
    window.open(`https://sp.zalo.me/share_inline?link=${url}`, '_blank', 'noopener,noreferrer,width=600,height=400')
  }
}

const copyArticleLink = async () => {
  const url = getArticleUrl()
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    copiedArticleLink.value = true
    toast.success('Đã sao chép liên kết bài viết vào bộ nhớ tạm!')
    setTimeout(() => { copiedArticleLink.value = false }, 2500)
  } catch {
    toast.error('Không thể sao chép liên kết.')
  }
}

/**
 * In bài — mở trang in riêng (layout báo giấy, không nav/sidebar/chat) tại
 * `/in-bai/<slug>?back=<backTo>` trong tab mới, tự kích hoạt window.print()
 * sau khi tải xong. Trả về trải nghiệm in báo giấy thay vì in nguyên trang web
 * (xấu, đầy menu/quảng cáo/bình luận).
 *
 * Mở với `noopener,noreferrer`: route `/in-bai` không đọc `window.opener` (nút quay
 * lại của nó dùng `?back=`), nên cửa sổ in không cần — và không được — cầm tham chiếu
 * về trang này. (Ghi chú cũ nói ngược lại — "noopener không dùng ở đây" — trong khi mã
 * vẫn truyền `noopener`; sửa lời, không đổi mã.)
 */
const printArticle = () => {
  if (typeof window === 'undefined') return
  const url = `/in-bai/${props.slug}?back=${encodeURIComponent(props.backTo)}`
  window.open(url, '_blank', 'noopener,noreferrer,width=900,height=700')
}
</script>

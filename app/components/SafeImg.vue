<template>
  <!--
    SafeImg — NuxtImg với fallback khi ảnh IPX/R2 404.
    `@error` native (bubbling từ <img> NuxtImg sinh ra) chuyển sang `fallbackSrc`.
    Lý do: IPX fetch R2 URL có thể 404 (ảnh bị xoá/chưa upload) → NuxtImg vỡ.
    Fallback `/assets/default_cover_light.png` (93KB, IPX đọc được từ public/).
    Chỉ Mark khi lỗi thật — không xoá src gốc nếu ảnh đã load OK.
  -->
  <NuxtImg
    :src="currentSrc"
    :alt="alt"
    :class="imgClass"
    :loading="loading"
    :decoding="decoding"
    :sizes="sizes"
    @error="onError"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  src: string | null | undefined
  alt?: string
  imgClass?: string
  loading?: 'lazy' | 'eager'
  decoding?: 'async' | 'sync' | 'auto'
  sizes?: string
  fallback?: string
}>(), {
  alt: '',
  imgClass: '',
  loading: 'lazy',
  decoding: 'async',
  sizes: '',
  fallback: '/assets/default_cover_light.png',
})

const failed = ref(false)
const currentSrc = ref(props.src || props.fallback)

watch(() => props.src, (v) => {
  failed.value = false
  currentSrc.value = v || props.fallback
})

const onError = () => {
  if (failed.value) return
  failed.value = true
  currentSrc.value = props.fallback
}
</script>

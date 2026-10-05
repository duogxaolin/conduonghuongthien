<template>
  <div></div>
</template>

<script setup lang="ts">
/**
 * Route registration stub cho `/<type>/<X>` (2-segment).
 *
 * Nuxt 4 nested routing: `[slug].vue` là parent route `:slug`, file ini là child
 * `:id` — sự tồn tại của file này đăng ký route `/:slug/:id` với Vue Router. Tuy
 * nhiên parent `[slug].vue` KHÔNG có `<NuxtPage />`, nên child không bao giờ
 * render — toàn bộ logic dishwasher (category list vs article detail) nằm ở
 * parent `[slug].vue` qua `route.params.id`.
 *
 * Xóa file này = mất route `/:slug/:id` → `/test_the_loai/<bài>` 404. Đừng xóa.
 * Thêm logic vào file này = logic chết (không render). Đừng thêm.
 */
</script>

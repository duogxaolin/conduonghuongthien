<template>
  <ArticleDetail
    :slug="slug"
    back-to="/news"
    back-label="Bản tin"
    back-cta-label="Quay lại danh sách Bản tin"
    current-crumb="Chi tiết tin tức"
    meta-icon="📰"
    :type-labels="typeLabels"
    not-found-text="Không tìm thấy tin tức yêu cầu hoặc bài viết đang được cập nhật."
    seo-fallback-title="Chi tiết tin tức | Con Đường Hướng Thiện"
    seo-fallback-description="Tin tức và hoạt động hỗ trợ hoàn lương, tái hòa nhập cộng đồng."
  />
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'

// This route renders any article type, so the badge falls back to the type name.
const typeLabels = {
  news:          'Bản tin',
  role_model:    'Tấm gương',
  reintegration: 'Mô hình tái hòa nhập',
  document:      'Văn bản pháp luật',
  faq:           'Giải đáp pháp luật',
}

const route = useRoute()
const slug = String(route.params.id || '')
</script>

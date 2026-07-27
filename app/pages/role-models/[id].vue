<template>
  <ArticleDetail
    :slug="slug"
    back-to="/role-models"
    back-label="Tấm gương tiêu biểu"
    back-cta-label="Quay lại danh sách tấm gương"
    current-crumb="Chi tiết câu chuyện"
    meta-icon="📍"
    category-fallback="Tấm gương tiêu biểu"
    seo-fallback-title="Tấm gương tiêu biểu | Con Đường Hướng Thiện"
    seo-fallback-description="Câu chuyện hoàn lương lập nghiệp tiêu biểu."
  />
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
const slug = String(route.params.id || '')
</script>

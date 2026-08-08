<template>
  <ArticleDetail
    :slug="slug"
    back-to="/reintegration-models"
    back-label="Mô hình tái hòa nhập"
    back-cta-label="Quay lại danh sách mô hình"
    current-crumb="Chi tiết mô hình"
    meta-icon="💡"
    category-fallback="Mô hình tiêu biểu"
    not-found-text="Không tìm thấy mô hình yêu cầu hoặc nội dung đang được cập nhật."
    seo-fallback-title="Mô hình tái hòa nhập | Con Đường Hướng Thiện"
    seo-fallback-description="Mô hình tiêu biểu hỗ trợ người hoàn lương tái hòa nhập cộng đồng."
  />
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
const slug = String(route.params.id || '')
</script>

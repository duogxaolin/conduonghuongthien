<template>
  <ArticleDetail
    :slug="slug"
    back-to="/role-models"
    variant="role"
    :back-label="t('a_back_role')"
    meta-icon="📍"
    :seo-fallback-title="t('a_role_seo_title')"
    :seo-fallback-description="t('a_role_seo_desc')"
  />
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()

const route = useRoute()
const slug = String(route.params.id || '')
</script>

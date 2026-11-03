<script setup lang="ts">
import type { PreviewHotspot } from '~/utils/docs/previews'

import SkeletonHome from './skeletons/SkeletonHome.vue'
import SkeletonArticleDetail from './skeletons/SkeletonArticleDetail.vue'
import SkeletonNewsList from './skeletons/SkeletonNewsList.vue'
import SkeletonAdminDashboard from './skeletons/SkeletonAdminDashboard.vue'
import SkeletonAdminArticlesList from './skeletons/SkeletonAdminArticlesList.vue'
import SkeletonAdminArticleEdit from './skeletons/SkeletonAdminArticleEdit.vue'

defineProps<{
  layout: string
  hotspots: PreviewHotspot[]
}>()

const emit = defineEmits<{ 'hotspot-click': [docSlug: string, anchor?: string] }>()

const onHotspotClick = (docSlug: string, anchor?: string) => {
  emit('hotspot-click', docSlug, anchor)
}
</script>

<template>
  <div class="bg-white rounded-xl border border-line p-6">
    <SkeletonHome
      v-if="layout === 'home'"
      :hotspots="hotspots"
      @hotspot-click="onHotspotClick"
    />
    <SkeletonArticleDetail
      v-else-if="layout === 'article-detail'"
      :hotspots="hotspots"
      @hotspot-click="onHotspotClick"
    />
    <SkeletonNewsList
      v-else-if="layout === 'news-list'"
      :hotspots="hotspots"
      @hotspot-click="onHotspotClick"
    />
    <SkeletonAdminDashboard
      v-else-if="layout === 'admin-dashboard'"
      :hotspots="hotspots"
      @hotspot-click="onHotspotClick"
    />
    <SkeletonAdminArticlesList
      v-else-if="layout === 'admin-articles-list'"
      :hotspots="hotspots"
      @hotspot-click="onHotspotClick"
    />
    <SkeletonAdminArticleEdit
      v-else-if="layout === 'admin-article-edit'"
      :hotspots="hotspots"
      @hotspot-click="onHotspotClick"
    />
  </div>
</template>

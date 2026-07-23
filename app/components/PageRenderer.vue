<template>
  <div>
    <template v-for="block in blocks" :key="block.id">
      <component :is="resolve(block.blockType)" v-if="resolve(block.blockType)" :block="block" />
      <!-- Unknown block types are silently skipped (defensive against stale/removed types). -->
    </template>
  </div>
</template>

<script setup>
// Maps each blockType (registry key) to its renderer component.
// Section components reuse the exact markup from the former index.vue so the
// public design is preserved; content components are new.
import HeroBlock from './blocks/HeroBlock.vue'
import StatsBlock from './blocks/StatsBlock.vue'
import NewsBlock from './blocks/NewsBlock.vue'
import RoleModelsBlock from './blocks/RoleModelsBlock.vue'
import ReintegrationBlock from './blocks/ReintegrationBlock.vue'
import DocumentsBlock from './blocks/DocumentsBlock.vue'
import SupportFormBlock from './blocks/SupportFormBlock.vue'
import LinksBlock from './blocks/LinksBlock.vue'
import HeadingBlock from './blocks/HeadingBlock.vue'
import RichTextBlock from './blocks/RichTextBlock.vue'
import ImageBlock from './blocks/ImageBlock.vue'
import CtaBlock from './blocks/CtaBlock.vue'
import GalleryBlock from './blocks/GalleryBlock.vue'
import ContactFormBlock from './blocks/ContactFormBlock.vue'

defineProps({ blocks: { type: Array, default: () => [] } })

const MAP = {
  hero: HeroBlock,
  stats: StatsBlock,
  news: NewsBlock,
  role_models: RoleModelsBlock,
  reintegration: ReintegrationBlock,
  documents: DocumentsBlock,
  support_form: SupportFormBlock,
  links: LinksBlock,
  heading: HeadingBlock,
  richtext: RichTextBlock,
  image: ImageBlock,
  cta: CtaBlock,
  gallery: GalleryBlock,
  contact_form: ContactFormBlock,
}

const resolve = (type) => MAP[type] || null
</script>

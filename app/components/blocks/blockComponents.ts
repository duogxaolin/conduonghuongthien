// ─── Shared blockType → component map ────────────────────────────────────────
// Single source of truth for which Vue component renders each block type.
// Consumed by both the public renderer (PageRenderer.vue) and the admin live
// canvas (admin/builder/BuilderCanvas.vue) so the editor preview is pixel-for-
// pixel the same as the published page — this is what keeps client ↔ admin in sync.
import type { Component } from 'vue'

import HeroBlock from './HeroBlock.vue'
import StatsBlock from './StatsBlock.vue'
import NewsBlock from './NewsBlock.vue'
import RoleModelsBlock from './RoleModelsBlock.vue'
import ReintegrationBlock from './ReintegrationBlock.vue'
import DocumentsBlock from './DocumentsBlock.vue'
import SupportFormBlock from './SupportFormBlock.vue'
import LinksBlock from './LinksBlock.vue'
import HeadingBlock from './HeadingBlock.vue'
import RichTextBlock from './RichTextBlock.vue'
import ImageBlock from './ImageBlock.vue'
import CtaBlock from './CtaBlock.vue'
import GalleryBlock from './GalleryBlock.vue'
import ContactFormBlock from './ContactFormBlock.vue'

export const BLOCK_COMPONENTS: Record<string, Component> = {
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

/** Returns the renderer component for a blockType, or null if unknown (stale/removed). */
export const resolveBlockComponent = (type: string): Component | null =>
  BLOCK_COMPONENTS[type] || null

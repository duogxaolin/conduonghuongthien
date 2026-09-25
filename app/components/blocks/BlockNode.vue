<template>
  <!-- Hidden nodes (and their whole subtree) render nothing. -->
  <template v-if="node && node.isVisible !== false">
    <!-- ─── Container: section (full-width band) ─── -->
    <section
      v-if="nodeType === 'section'"
      :data-block-id="interactive ? node.id : undefined"
      :class="[sectionClasses, interactiveClass]"
    >
      <div class="container">
        <BlockNode
          v-for="child in visibleChildren"
          :key="child.id"
          :node="child"
          :interactive="interactive"
          :selected-id="selectedId"
        />
      </div>
    </section>

    <!-- ─── Container: row (12-column grid) ─── -->
    <div
      v-else-if="nodeType === 'row'"
      :data-block-id="interactive ? node.id : undefined"
      :class="['grid grid-cols-12', rowGapClass, rowAlignClass, interactiveClass]"
    >
      <BlockNode
        v-for="child in visibleChildren"
        :key="child.id"
        :node="child"
        :interactive="interactive"
        :selected-id="selectedId"
      />
    </div>

    <!-- ─── Container: column (spans 1–12 via inline grid-column) ─── -->
    <div
      v-else-if="nodeType === 'column'"
      :data-block-id="interactive ? node.id : undefined"
      :style="{ gridColumn: `span ${span} / span ${span}` }"
      :class="['min-w-0', interactiveClass]"
    >
      <BlockNode
        v-for="child in visibleChildren"
        :key="child.id"
        :node="child"
        :interactive="interactive"
        :selected-id="selectedId"
      />
    </div>

    <!-- ─── Leaf: existing block component (interactive wrapper) ─── -->
    <div
      v-else-if="interactive && leafComponent"
      :data-block-id="node.id"
      :class="interactiveClass"
    >
      <component :is="leafComponent" :block="localizedNode" />
    </div>

    <!-- ─── Leaf: existing block component (public render) ─── -->
    <component
      :is="leafComponent"
      v-else-if="leafComponent"
      :block="localizedNode"
    />
    <!-- Unknown node types are skipped silently. -->
  </template>
</template>

<script setup lang="ts">
// Recursive renderer for the unified node tree. One node → one rendered element,
// recursing over `node.children` for containers. Shared by the public page
// (PageRenderer) and the builder iframe preview (interactive mode), so what the
// editor sees is byte-for-byte the published output.
//
// Node shape: { id, blockType, data, isVisible, colSpan?, children?[] }.
// A legacy flat block (no children, non-container blockType) renders as a leaf.
import { computed } from 'vue'
import { isContainerType, clampColSpan } from '~/utils/blocks/registry'
import { blockText } from '~/utils/blocks/types'
import type { RenderableNode } from '~/utils/blocks/types'
import { resolveBlockComponent } from './blockComponents'
import { useI18n } from '~/composables/useI18n'

const { currentLang, t } = useI18n()

const VIETNAMESE_TEXT_TO_I18N_KEY: Record<string, string> = {
  'Tấm Gương Tiêu Biểu': 'role_models_title',
  'Tấm Gương Sáng Điển Hình': 'role_models_title',
  'Nghị lực vươn lên': 'role_models_subtitle',
  'Mô Hình Tái Hòa Nhập': 'reintegration_models_title',
  'Sinh kế bền vững': 'reintegration_models_subtitle',
  'Văn bản Pháp luật Mới ban hành': 'latest_docs_title',
  'Tin nổi bật': 'news_featured',
  'Bản tin hoạt động': 'news',
  'Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập': 'support_form_title',
  'Điền thông tin để cán bộ chuyên môn liên hệ tư vấn miễn phí trong vòng 24 giờ.': 'support_form_subtitle',
  'Hotline hỗ trợ:': 'hotline_support_lbl',
  'Họ và tên': 'form_name',
  'Số điện thoại': 'form_phone',
  'Tỉnh / Thành phố': 'form_city',
  'Nội dung cần hỗ trợ': 'form_message',
  'Gửi đăng ký tư vấn': 'form_submit',
  'Đang gửi...': 'form_sending',
  'Tất cả văn bản': 'view_all_docs',
  'Tất cả văn bản →': 'view_all_docs',
  'Xem chi tiết': 'view_detail',
  'Xem tất cả': 'view_all',
  'Hỗ trợ 24/7 miễn phí': 'hero_support_free',
  'Bảo mật thông tin': 'hero_security',
  'Kết nối trực tiếp cán bộ': 'hero_connect_officer',
}
// tuỳ chọn vì phần tải công khai cắt bỏ chúng (chỉ chứa node đang hiện). Khớp
// đúng cách component này vốn đã đọc cờ đó — `isVisible !== false`, nên vắng mặt
// nghĩa là vẽ. `BuilderNode` của trình dựng trang vẫn thoả kiểu này.
const props = defineProps<{
  node: RenderableNode
  interactive?: boolean
  selectedId?: number | string | null
}>()

const nodeType = computed(() => (isContainerType(props.node?.blockType) ? props.node.blockType : 'leaf'))

// Children that are themselves visible (subtree pruning is recursive: a hidden
// child simply renders nothing via the top-level v-if).
const visibleChildren = computed(() => (Array.isArray(props.node?.children) ? props.node.children : []))

const leafComponent = computed(() => resolveBlockComponent(props.node?.blockType))

const localizedNode = computed(() => {
  if (!props.node) return props.node
  const lang = currentLang.value
  if (lang === 'vi' || !props.node.data) return props.node

  const rawData = props.node.data as Record<string, unknown>
  const translations = rawData.translations as Record<string, Record<string, unknown>> | undefined
  const langOverrides = translations?.[lang] || {}

  const mergedData: Record<string, unknown> = { ...rawData, ...langOverrides }

  for (const key of ['title', 'subtitle', 'heading', 'badge', 'btnText', 'buttonText', 'description']) {
    if (typeof rawData[key] === 'string' && !langOverrides[key]) {
      const val = (rawData[key] as string).trim()
      const i18nKey = VIETNAMESE_TEXT_TO_I18N_KEY[val]
      if (i18nKey) {
        const translated = t(i18nKey)
        if (translated && translated !== i18nKey) {
          mergedData[key] = translated
          continue
        }
      }
      const dictVal = t(val)
      if (dictVal && dictVal !== val) {
        mergedData[key] = dictVal
      }
    }
  }

  return {
    ...props.node,
    data: mergedData,
  }
})

const span = computed(() => clampColSpan(props.node?.colSpan))

// Interactive selection outline (builder preview only).
const interactiveClass = computed(() => {
  if (!props.interactive) return ''
  const selected = props.selectedId != null && props.node?.id === props.selectedId
  return [
    'relative cursor-pointer transition-[outline] [outline-offset:-2px]',
    selected ? 'outline outline-2 outline-green-600' : 'hover:outline hover:outline-2 hover:outline-green-400/70',
  ]
})

// ── Section band appearance (static class maps so Tailwind never purges them) ──
const SECTION_BG: Record<string, string> = {
  white: 'bg-white',
  light: 'bg-gray-50',
  green: 'bg-green-800 text-white',
}
const SECTION_PY: Record<string, string> = {
  none: 'py-0',
  sm: 'py-6',
  md: 'py-12',
  lg: 'py-20',
}
const sectionClasses = computed(() => {
  const d = props.node?.data || {}
  return [
    SECTION_BG[blockText(d, 'bgVariant')] || SECTION_BG.white,
    SECTION_PY[blockText(d, 'paddingY')] || SECTION_PY.md,
  ]
})

// ── Row grid gap + vertical alignment (static maps) ──
const ROW_GAP: Record<string, string> = {
  none: 'gap-0',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-8',
}
const ROW_ALIGN: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  stretch: 'items-stretch',
}
const rowGapClass = computed(() => ROW_GAP[blockText(props.node?.data ?? {}, 'gap')] || ROW_GAP.md)
const rowAlignClass = computed(() => ROW_ALIGN[blockText(props.node?.data ?? {}, 'align')] || ROW_ALIGN.stretch)
</script>

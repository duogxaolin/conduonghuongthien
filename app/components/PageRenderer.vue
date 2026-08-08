<template>
  <!-- Loading: a banner band plus a content grid, matching the shape every
       block-built page opens with (`/` leads on a hero block; `/about` and
       `/contact` lead on a heading block with variant 'banner'). Reachable only
       through client-side navigation — during SSR the page awaits its payload,
       so the server always serialises real content (design.md D2). -->
  <div v-if="pending" role="status" aria-busy="true">
    <span class="sr-only">Đang tải nội dung trang</span>
    <div class="h-[280px] w-full animate-pulse bg-[#EEF2EC] motion-reduce:animate-none" aria-hidden="true"></div>
    <div class="container py-12" aria-hidden="true">
      <div class="mx-auto mb-8 h-6 w-64 animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
      <div class="grid grid-cols-1 gap-[30px] md:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="n in 3"
          :key="n"
          class="overflow-hidden rounded-lg border border-[#E2E8DF] bg-white shadow-sm"
        >
          <div class="h-[220px] animate-pulse bg-[#EEF2EC] motion-reduce:animate-none"></div>
          <div class="flex flex-col gap-3 p-6">
            <div class="h-3 w-32 animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
            <div class="h-4 w-3/4 animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
            <div class="h-3 w-full animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Error: terminal and recoverable. A placeholder that never resolves is the
       original complaint with a false promise attached (design.md D5), so the
       retry re-runs the page's own fetch rather than reloading the document. -->
  <div v-else-if="loadError" class="container py-20">
    <div
      class="mx-auto max-w-[700px] rounded-lg border border-dashed border-[#E2A0A0] bg-white px-6 py-10 text-center text-[0.95rem] text-[#B04A4A]"
      role="alert"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      Không thể tải nội dung trang.
      <template v-if="onRetry">
        Vui lòng
        <button type="button" class="font-bold text-[#4A6741] underline" @click="onRetry()">thử lại</button>.
      </template>
    </div>
  </div>

  <div v-else>
    <BlockNode
      v-for="node in blocks"
      :key="node.id"
      :node="node"
      :interactive="interactive"
      :selected-id="selectedId"
    />
  </div>
</template>

<script setup lang="ts">
// Renders a page's node tree. Each root node is delegated to the recursive
// BlockNode, which handles containers (section/row/column) and leaf blocks alike.
// A legacy flat array is simply a list of childless root nodes — rendered
// identically to before (each maps to its block component).
//
// `interactive` + `selectedId` are only set when embedded in the builder preview
// (see usePagePreview); on the live site both are inert.
//
// `pending` / `loadError` / `onRetry` host the shared loading and error states
// for the four block-built pages (`/`, `/about`, `/contact`, `/<slug>`). They
// live here rather than inline in each page because the placeholder is identical
// across all four — see design.md D3.
import BlockNode from './blocks/BlockNode.vue'
import type { RenderableNode } from '~/utils/blocks/types'

/**
 * Khai bằng generic thay vì object runtime: `blocks: { type: Array }` suy ra
 * `unknown[]`, nên `:node="node"` truyền `unknown` vào một prop đòi `BuilderNode`
 * và mọi phép đọc `node.blockType` trong template mất kiểm kiểu. `BlockNode` con
 * **đã** dùng lối này (`defineProps<{ node: BuilderNode … }>`), nên trước đây hợp
 * đồng chỉ được kiểm ở một đầu của đúng chỗ nó cần khớp hai đầu.
 *
 * `loadError` là `unknown`, không phải một hình dạng lỗi cụ thể: nó đến từ
 * `error.value` của `useFetch`/`useAsyncData` và template chỉ dùng nó làm điều
 * kiện truthy — khai hẹp hơn thực tế là khẳng định một hình dạng chưa ai kiểm.
 */
defineProps<{
  blocks?: RenderableNode[]
  interactive?: boolean
  selectedId?: number | string | null
  pending?: boolean
  loadError?: unknown
  onRetry?: (() => void) | null
}>()
</script>

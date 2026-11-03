<template>
  <div class="flex h-[calc(100vh-6.5rem)] flex-col">
    <!-- Top bar -->
    <PageBuilderTopBar
      :page="page"
      :loaded="loaded"
      :draft-status="draftStatus"
      :has-unpublished="hasUnpublished"
      :publishing="publishing"
      @discard="discardDraft"
      @open-versions="openVersions"
      @open-meta="openMeta"
      @publish="publish"
    />

    <!-- Loading — the 3-pane workspace footprint (tree / canvas / properties),
         inline because this layout exists nowhere else in the project. -->
    <div
      v-if="loading"
      class="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
      role="status"
      aria-busy="true"
    >
      <span class="sr-only">Đang tải trình dựng trang</span>
      <aside class="flex w-64 shrink-0 flex-col border-r border-gray-200" aria-hidden="true">
        <div class="shrink-0 border-b border-gray-200 p-3">
          <div class="h-9 w-full rounded-lg bg-line animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex-1 p-2 flex flex-col gap-2">
          <div v-for="n in 6" :key="'bt-' + n" class="h-8 w-full rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        </div>
      </aside>
      <div class="min-w-0 flex-1 p-6 flex flex-col gap-4" aria-hidden="true">
        <div class="h-[180px] w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        <div class="h-[120px] w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        <div class="h-[120px] w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
      </div>
      <aside class="w-80 shrink-0 border-l border-gray-200 p-4 flex flex-col gap-3" aria-hidden="true">
        <div class="h-4 w-32 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
        <div v-for="n in 4" :key="'pp-' + n" class="flex flex-col gap-1.5">
          <div class="h-3 w-24 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
          <div class="h-9 w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        </div>
      </aside>
    </div>
    <div v-else-if="loadError" role="alert" class="flex flex-1 flex-col items-center justify-center gap-3 text-red-600">
      <p>{{ loadError }}</p>
      <button class="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold hover:bg-red-100" @click="fetchPage">Thử lại</button>
    </div>

    <!-- 3-pane workspace -->
    <div v-else class="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <!-- Left: recursive tree navigator -->
      <aside class="flex w-64 shrink-0 flex-col border-r border-gray-200">
        <div class="shrink-0 border-b border-gray-200 p-3">
          <button class="flex w-full items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800" @click="openPalette(null)">
            <i class="fa-solid fa-plus"></i> Thêm khối
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <p v-if="!blocks.length" class="px-2 py-4 text-center text-xs text-gray-400">Chưa có khối nào.</p>
          <BlockTreeNode
            v-for="node in blocks"
            :key="node.id"
            :node="node"
            :depth="0"
          />
        </div>
      </aside>

      <!-- Center: live canvas -->
      <BuilderCanvas
        class="min-w-0 flex-1"
        :blocks="blocks"
        :selected-id="selectedId"
        :viewport="viewport"
        :preview-path="previewPath"
        @select="selectedId = $event"
        @update:viewport="viewport = $event"
      />

      <!-- Right: property panel -->
      <aside class="w-80 shrink-0 border-l border-gray-200">
        <PropertyPanel
          :block="selectedBlock"
          :index="selectedIndex"
          :total="selectedSiblingCount"
          @move="move"
          @duplicate="duplicateBlock"
          @delete="removeBlock"
          @toggle-visible="toggleVisible"
        />
      </aside>
    </div>

    <!-- Block palette drawer (context-filtered) -->
    <BlockPaletteDrawer
      :open="showPalette"
      :adding="adding"
      :context-label="paletteContextLabel"
      :groups="paletteGroups"
      @close="showPalette = false"
      @add="addBlock"
    />

    <!-- Meta modal -->
    <PageMetaModal
      v-model:form="metaForm"
      :open="showMeta"
      :saving="savingMeta"
      :is-system="page?.isSystem === true"
      @close="showMeta = false"
      @save="saveMeta"
    />

    <!-- Versions drawer -->
    <PageVersionsDrawer
      v-model:label="backupLabel"
      :open="showVersions"
      :versions="versions"
      :loading="versionsLoading"
      :failed="!!versionsError"
      :saving="savingBackup"
      :manual-count="manualCount"
      :has-origin="hasOrigin"
      @close="showVersions = false"
      @save="saveBackup"
      @set-origin="setOrigin"
      @restore="restoreVersion"
      @delete="deleteVersion"
    >
      <!-- Danh sách đọc hỏng: lỗi + "Thử lại" (chỉ lượt đọc danh sách) thay chỗ danh sách (FINDING-B1) -->
      <template #error>
        <div v-if="versionsError" role="alert" class="bg-danger-bg text-danger px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
          <span>{{ versionsError }}</span>
          <button type="button" class="shrink-0 text-sm font-bold underline text-danger bg-transparent border-0 cursor-pointer p-0 hover:no-underline" @click="loadVersions">Thử lại</button>
        </div>
      </template>
    </PageVersionsDrawer>
  </div>
</template>

<script setup lang="ts">
/**
 * Trình dựng trang (Page Builder). Tách (wave3 4.2, docs/decisions/refactor-large-files.md):
 *  - `components/admin/page-builder/*.vue` — thanh trên, ngăn "Thêm khối", hộp "Cấu hình
 *    trang", ngăn "Phiên bản": chỉ hiển thị, props vào, sự kiện ra;
 *  - `useBuilderTreeEdits` (thêm từ bảng chọn, nhân đôi, ẩn/hiện, xoá, di chuyển),
 *    `usePageVersions` (sao lưu, bản gốc, khôi phục, xoá phiên bản), `usePageMeta`;
 *  - `utils/blocks/builder-tree.ts` — tìm/định vị nút, chuẩn hoá, tuần tự hoá, sao chép cây.
 * Trang giữ: trang + cây đang dựng + lựa chọn, lượt tải `fetchPage` với khung chờ và nhánh lỗi
 * `role="alert"` + "Thử lại", toàn bộ vòng đời bản nháp (`hydrating`, hẹn giờ lưu, xuất bản,
 * huỷ sửa, nạp một bản vào cây), danh sách phiên bản + lượt tải của nó, `provide('builderTree')`.
 */
import type { PageVersionRow, AdminPageDetail } from '~/types/admin-api'
import type { PageDraftSaveResponse, PagePublishResponse, PageVersionsResponse } from '~/types/admin-pages-api'
import { provide } from 'vue'
import { blockText } from '~/utils/blocks/types'
import type { BuilderTreeApi, NodeId } from '~/utils/blocks/types'
import type { BuilderNode } from '~/utils/blocks/types'
import { createTmpIds, findNode, hydrateNodes, locateNode, serializeNodes, strip } from '~/utils/blocks/builder-tree'
import { useBuilderTreeEdits } from '~/composables/useBuilderTreeEdits'
import { usePageVersions } from '~/composables/usePageVersions'
import { usePageMeta } from '~/composables/usePageMeta'

/** A node id: numeric once persisted, `tmp_*` while unsaved, null for "root". */
// `undefined` is part of the domain: BlockNode.id is optional until the node is
// persisted, so every lookup by id has to accept a not-yet-saved node.

import BuilderCanvas from '~/components/admin/builder/BuilderCanvas.vue'
import PropertyPanel from '~/components/admin/builder/PropertyPanel.vue'
import BlockTreeNode from '~/components/admin/builder/BlockTreeNode.vue'
import PageBuilderTopBar from '~/components/admin/page-builder/PageBuilderTopBar.vue'
import BlockPaletteDrawer from '~/components/admin/page-builder/BlockPaletteDrawer.vue'
import PageMetaModal from '~/components/admin/page-builder/PageMetaModal.vue'
import PageVersionsDrawer from '~/components/admin/page-builder/PageVersionsDrawer.vue'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const pageId = computed(() => Number(route.params.id))
const toast = useToast()
const { confirm } = useConfirm()

// Hàng từ endpoint CHI TIẾT, không phải từ danh sách: danh sách kèm thêm
// `blockCount` mà trang này không nhận, nên dùng nhầm kiểu sẽ khai một trường
// vĩnh viễn `undefined`.
const page = ref<AdminPageDetail['page'] | null>(null)
const blocks = ref<BuilderNode[]>([])
const loading = ref(true)
const loadError = ref('')
// Cờ DƯƠNG: cây đang dựng là trang thật chỉ sau một lượt tải thành công. Chưa có (đang tải,
// tải hỏng, "Thử lại" đang bay) thì mọi thao tác trên trang — xuất bản, huỷ sửa, lưu nháp,
// "Phiên bản", "Cấu hình" — không chạy: cây rỗng từng được xuất bản đè trang thật (FINDING-B2).
const loaded = ref(false)

const selectedId = ref<number | string | null>(null)
const viewport = ref<'desktop' | 'tablet' | 'mobile'>('desktop')

const selectedBlock = computed(() => (selectedId.value == null ? null : findNode(selectedId.value, blocks.value)))
// Index of the selected node among its own siblings (for move ▲/▼ bounds).
const selectedLoc = computed(() => (selectedId.value == null ? null : locateNode(selectedId.value, blocks.value)))
const selectedIndex = computed(() => selectedLoc.value?.index ?? -1)
const selectedSiblingCount = computed(() => selectedLoc.value?.siblings.length ?? 0)

// Temp ids for blocks not yet persisted to page_blocks (assigned real ids on publish).
const nextTmpId = createTmpIds()

// Snapshot of what's actually LIVE (published), for the dirty comparison.
const publishedSnapshot = ref('')
const hasUnpublished = computed(() => JSON.stringify(strip(blocks.value)) !== publishedSnapshot.value)

// Draft-save network state (independent of the publish/dirty state); the top bar shows it.
type DraftStatus = 'idle' | 'saving' | 'saved' | 'error'
const draftStatus = ref<DraftStatus>('idle')
const publishing = ref(false)

// Public route the preview iframe loads ('home' → '/', others → '/<slug>').
const previewPath = computed(() => (!page.value ? '/' : page.value.slug === 'home' ? '/' : `/${page.value.slug}`))

const fetchPage = async () => {
  loading.value = true
  loadError.value = ''
  loaded.value = false // trước await: lượt tải lại đang bay không giữ quyền thao tác của lượt trước
  hydrating = true
  try {
    /**
     * Kiểu suy từ chính handler, không từ URL: fetch trần của Nuxt suy theo **chuỗi URL**, mà URL
     * ở đây dựng động nên nó khớp nhầm sang một route khác cùng tiền tố — rồi báo là
     * `res.draft` không tồn tại trong khi endpoint có trả.
     */
    const res = await adminFetch<AdminPageDetail>(`/api/admin/pages/${pageId.value}`)
    if (res.ok) {
      page.value = res.page
      // Published blocks are the live baseline for the dirty check.
      const published = hydrateNodes(res.blocks || [], nextTmpId)
      publishedSnapshot.value = JSON.stringify(strip(published))
      // If a draft exists on the server, load it as the working copy instead.
      const draftBlocks = res.draft?.blocks
      if (Array.isArray(draftBlocks) && res.draft) {
        blocks.value = hydrateNodes(draftBlocks, nextTmpId)
        draftStatus.value = 'saved'
      } else {
        blocks.value = published
        draftStatus.value = 'idle'
      }
      selectedId.value = blocks.value[0]?.id ?? null
      loaded.value = true
    }
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không tải được trang.')
  } finally {
    loading.value = false
    nextTick(() => { hydrating = false })
  }
}

const blockPreviewText = (block: BuilderNode) => {
  const d = block.data || {}
  for (const key of ['title', 'text', 'badge', 'titleLine1']) {
    const value = blockText(d, key)
    if (value) return value
  }
  const html = blockText(d, 'html')
  return html ? html.replace(/<[^>]+>/g, '').slice(0, 40) : '—'
}

// ── Draft auto-save (debounced) — saves the WHOLE working copy as draft JSON ──
let saveTimer: ReturnType<typeof setTimeout> | null = null
let hydrating = true // suppress draft saves during the initial load

const scheduleDraftSave = () => {
  if (hydrating || !loaded.value) return
  draftStatus.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveDraft, 800)
}

const draftPayload = () => serializeNodes(blocks.value)

const saveDraft = async () => {
  draftStatus.value = 'saving'
  try {
    await adminFetch<PageDraftSaveResponse>(`/api/admin/pages/${pageId.value}/draft`, { method: 'PUT', body: { blocks: draftPayload() } })
    draftStatus.value = 'saved'
  } catch (err: unknown) {
    draftStatus.value = 'error'
    toast.error(errorMessage(err, 'Không lưu được nháp.'))
  }
}

// Deep-watch the whole working copy → debounce a draft save.
watch(blocks, () => scheduleDraftSave(), { deep: true })

/** A copy loaded from the server (a restored version) becomes the working copy — a draft, not saved back. */
const loadWorkingCopy = (list: unknown) => {
  hydrating = true
  blocks.value = hydrateNodes(list || [], nextTmpId)
  selectedId.value = blocks.value[0]?.id ?? null
  draftStatus.value = 'saved'
  nextTick(() => { hydrating = false })
}

// ── Publish: push draft → live, create an auto version, clear draft ──
const publish = async () => {
  if (publishing.value || !loaded.value) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  publishing.value = true
  try {
    const res = await adminFetch<PagePublishResponse>(`/api/admin/pages/${pageId.value}/publish`, { method: 'POST', body: { blocks: draftPayload() } })
    if (res.ok) {
      const prevSelected = selectedId.value
      hydrating = true
      blocks.value = hydrateNodes(res.blocks || [], nextTmpId)
      publishedSnapshot.value = JSON.stringify(strip(blocks.value))
      draftStatus.value = 'idle'
      // Keep the same node selected if it survived (real ids are stable on flat
      // pages); otherwise fall back to the first root node.
      selectedId.value = (prevSelected != null && findNode(prevSelected, blocks.value)) ? prevSelected : (blocks.value[0]?.id ?? null)
      nextTick(() => { hydrating = false })
      toast.success('Đã xuất bản lên site.')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xuất bản được.'))
  } finally {
    publishing.value = false
  }
}

// ── Discard draft → revert working copy back to what's live ──
const discardDraft = async () => {
  if (!loaded.value) return
  const ok = await confirm({ title: 'Hủy thay đổi', message: 'Bỏ toàn bộ chỉnh sửa chưa xuất bản và quay lại bản đang chạy trên site?', danger: true, confirmLabel: 'Hủy thay đổi' })
  if (!ok) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  hydrating = true
  try {
    await adminFetch<PageDraftSaveResponse>(`/api/admin/pages/${pageId.value}/draft`, { method: 'PUT', body: {} }) // clears draft → null
    await fetchPage() // reloads published (no draft present) and resets hydration flag
    toast.success('Đã quay lại bản đang chạy.')
  } catch (err: unknown) {
    hydrating = false
    toast.error(errorMessage(err, 'Không hủy được thay đổi.'))
  }
}

// ── Tree edits: palette/add, duplicate, visibility, delete, reorder (local; saved as draft) ──
const {
  showPalette, adding, openPalette, paletteGroups, paletteContextLabel, addBlock,
  duplicateBlock, toggleVisible, removeBlock, move,
} = useBuilderTreeEdits({ toast, confirm, blocks, selectedId, nextTmpId, scheduleDraftSave })

// Bridge injected by the recursive BlockTreeNode navigator: selection + contextual
// add. selectedId is exposed as the raw ref so children read `.value` reactively.
provide<BuilderTreeApi>('builderTree', {
  selectedId,
  select: (id: NodeId) => { selectedId.value = id ?? null },
  openPalette,
})

// ── Meta ──
const { showMeta, savingMeta, metaForm, openMeta, saveMeta } = usePageMeta({ toast, pageId, page, loaded })

// ── Versions: the list + its load here; the drawer's writes in usePageVersions ──
const versions = ref<PageVersionRow[]>([])
const versionsLoading = ref(false)
// Lượt đọc danh sách hỏng: ngăn kéo hiện lỗi thay danh sách — không phải "chưa có phiên bản nào".
const versionsError = ref('')

// Chỉ lượt tải MỚI NHẤT được ghi danh sách: lưu bản sao lưu ngay sau khi mở ngăn kéo
// làm hai lượt tải chồng nhau, và phản hồi của lượt đầu (chưa có bản vừa lưu) về sau
// thì đè mất bản mới.
let versionsLoadSeq = 0
const loadVersions = async () => {
  const seq = ++versionsLoadSeq
  versionsLoading.value = true
  versionsError.value = ''
  try {
    const res = await adminFetch<PageVersionsResponse>(`/api/admin/pages/${pageId.value}/versions`)
    if (seq === versionsLoadSeq && res.ok) versions.value = res.versions || []
  } catch (err: unknown) {
    if (seq === versionsLoadSeq) versionsError.value = errorMessage(err, 'Không tải được danh sách phiên bản.')
  } finally {
    if (seq === versionsLoadSeq) versionsLoading.value = false
  }
}

const {
  showVersions, savingBackup, backupLabel, manualCount, hasOrigin,
  openVersions, restoreVersion, deleteVersion, saveBackup, setOrigin,
} = usePageVersions({ toast, confirm, pageId, loaded, versions, loadVersions, draftPayload, loadWorkingCopy })

onMounted(fetchPage)
</script>

<template>
  <div class="flex h-[calc(100vh-6.5rem)] flex-col">
    <!-- Top bar -->
    <div class="flex shrink-0 items-center justify-between border-b border-gray-200 pb-3">
      <div class="flex items-center gap-3">
        <nuxt-link to="/admin/content/pages" class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50">
          <i class="fa-solid fa-arrow-left"></i>
        </nuxt-link>
        <div>
          <h1 class="text-lg font-bold text-gray-800">{{ page?.title || 'Trình dựng trang' }}</h1>
          <p class="mt-0.5 text-xs text-gray-500">
            <code class="rounded bg-gray-100 px-1.5 py-0.5">/{{ page?.slug === 'home' ? '' : page?.slug }}</code>
            <span v-if="page?.isSystem" class="ml-2 text-blue-600"><i class="fa-solid fa-lock"></i> Trang hệ thống</span>
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="mr-1 flex items-center gap-1.5 text-xs font-semibold" :class="saveState.color">
          <i :class="saveState.icon"></i> {{ saveState.text }}
        </span>
        <button v-if="hasUnpublished" class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50" title="Bỏ thay đổi chưa xuất bản" @click="discardDraft">
          <i class="fa-solid fa-rotate-left mr-1"></i> Hủy sửa
        </button>
        <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" @click="openVersions">
          <i class="fa-solid fa-clock-rotate-left mr-1"></i> Phiên bản
        </button>
        <nuxt-link v-if="page" :to="page.slug === 'home' ? '/' : `/${page.slug}`" target="_blank" class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <i class="fa-solid fa-up-right-from-square mr-1"></i> Xem trang
        </nuxt-link>
        <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" @click="openMeta">
          <i class="fa-solid fa-gear mr-1"></i> Cấu hình
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:opacity-50"
          :disabled="publishing || !hasUnpublished"
          @click="publish"
        >
          <i :class="publishing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-cloud-arrow-up'"></i>
          {{ publishing ? 'Đang xuất bản…' : 'Xuất bản' }}
        </button>
      </div>
    </div>

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
          <div class="h-9 w-full rounded-lg bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex-1 p-2 flex flex-col gap-2">
          <div v-for="n in 6" :key="'bt-' + n" class="h-8 w-full rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        </div>
      </aside>
      <div class="min-w-0 flex-1 p-6 flex flex-col gap-4" aria-hidden="true">
        <div class="h-[180px] w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        <div class="h-[120px] w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        <div class="h-[120px] w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
      </div>
      <aside class="w-80 shrink-0 border-l border-gray-200 p-4 flex flex-col gap-3" aria-hidden="true">
        <div class="h-4 w-32 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
        <div v-for="n in 4" :key="'pp-' + n" class="flex flex-col gap-1.5">
          <div class="h-3 w-24 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
          <div class="h-9 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
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
    <div v-if="showPalette" class="fixed inset-0 z-50 flex justify-end bg-black/40" @click.self="showPalette = false">
      <div class="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="text-lg font-bold text-gray-800">Thêm khối</h2>
          <button class="text-gray-400 hover:text-gray-600" @click="showPalette = false"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>
        <p class="mb-4 text-xs text-gray-400">{{ paletteContextLabel }}</p>
        <div v-for="group in paletteGroups" :key="group.key" class="mb-6">
          <h3 class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{{ group.title }}</h3>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="item in group.items"
              :key="item.type"
              class="flex flex-col items-start gap-2 rounded-lg border border-gray-200 p-3 text-left transition hover:border-green-500 hover:bg-green-50 disabled:opacity-50"
              :disabled="adding"
              @click="addBlock(item.type)"
            >
              <i :class="[item.icon, 'text-green-700']"></i>
              <span class="text-sm font-semibold text-gray-700">{{ item.label }}</span>
            </button>
          </div>
        </div>
        <p v-if="!paletteGroups.length" class="py-8 text-center text-sm text-gray-400">Không có khối phù hợp cho vị trí này.</p>
      </div>
    </div>

    <!-- Meta modal -->
    <div v-if="showMeta" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showMeta = false">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-4 text-lg font-bold text-gray-800">Cấu hình trang</h2>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">Tiêu đề trang</label>
            <input v-model="metaForm.title" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">Đường dẫn (slug)</label>
            <input v-model="metaForm.slug" type="text" :disabled="page?.isSystem === true" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600 disabled:bg-gray-100 disabled:text-gray-400" />
            <p v-if="page?.isSystem" class="mt-1 text-xs text-gray-400">Trang hệ thống không thể đổi đường dẫn.</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">SEO Title</label>
            <input v-model="metaForm.seoTitle" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">SEO Description</label>
            <textarea v-model="metaForm.seoDescription" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"></textarea>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100" @click="showMeta = false">Hủy</button>
          <button class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50" :disabled="savingMeta" @click="saveMeta">
            <i v-if="savingMeta" class="fa-solid fa-spinner fa-spin"></i> Lưu
          </button>
        </div>
      </div>
    </div>

    <!-- Versions drawer -->
    <div v-if="showVersions" class="fixed inset-0 z-50 flex justify-end bg-black/40" @click.self="showVersions = false">
      <div class="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div class="flex shrink-0 items-center justify-between border-b border-gray-200 p-5">
          <div>
            <h2 class="text-lg font-bold text-gray-800">Phiên bản</h2>
            <p class="mt-0.5 text-xs text-gray-500">1 bản gốc · tối đa 4 bản sao lưu · 5 bản tự động (cuộn vòng)</p>
          </div>
          <button class="text-gray-400 hover:text-gray-600" @click="showVersions = false"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>

        <!-- Actions -->
        <div class="shrink-0 space-y-3 border-b border-gray-200 bg-gray-50 p-4">
          <div class="flex gap-2">
            <input
              v-model="backupLabel"
              type="text"
              placeholder="Tên bản sao lưu…"
              class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
              @keyup.enter="manualCount < 4 && !savingBackup && saveBackup()"
            />
            <button
              class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
              :disabled="savingBackup || manualCount >= 4"
              :title="manualCount >= 4 ? 'Đã đạt tối đa 4 bản sao lưu' : 'Lưu nội dung đang dựng thành bản sao lưu'"
              @click="saveBackup"
            >
              <i :class="savingBackup ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-bookmark'"></i> Lưu ({{ manualCount }}/4)
            </button>
          </div>
          <button class="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100" @click="setOrigin">
            <i class="fa-solid fa-anchor"></i> {{ hasOrigin ? 'Cập nhật bản gốc' : 'Chỉ định làm bản gốc' }}
          </button>
        </div>

        <!-- List -->
        <div class="flex-1 overflow-y-auto p-4">
          <div v-if="versionsLoading" class="flex justify-center py-10 text-gray-400"><i class="fa-solid fa-spinner fa-spin text-xl"></i></div>
          <p v-else-if="!versions.length" class="py-10 text-center text-sm text-gray-400">Chưa có phiên bản nào. Bấm Xuất bản để tạo bản tự động đầu tiên.</p>
          <div
            v-for="v in versions"
            :key="v.id"
            class="mb-2 rounded-lg border border-gray-200 p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                  <i :class="[kindMeta[v.kind]?.icon, kindMeta[v.kind]?.color]"></i>
                  <span class="truncate">{{ v.label || kindMeta[v.kind]?.label || v.kind }}</span>
                </p>
                <p class="mt-0.5 text-xs text-gray-400">{{ kindMeta[v.kind]?.label }} · {{ v.blockCount }} block · {{ fmtDate(v.createdAt) }}</p>
              </div>
              <span v-if="v.kind === 'origin'" class="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[0.65rem] font-semibold text-blue-600">KHÓA</span>
            </div>
            <div class="mt-2 flex gap-2">
              <button class="flex-1 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100" @click="restoreVersion(v)">
                <i class="fa-solid fa-rotate-left mr-1"></i> Khôi phục
              </button>
              <button
                v-if="v.kind !== 'origin'"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50"
                @click="deleteVersion(v)"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PageVersionRow, AdminPageDetail, AdminPageUpdateResult } from '~/types/admin-api'
import { provide } from 'vue'
import { BLOCK_REGISTRY, blocksByCategory, getDefaultData, isContainerType, clampColSpan, DEFAULT_COL_SPAN } from '~/utils/blocks/registry'
import type { BlockNode, BuilderNode, NodeLocation } from '~/utils/blocks/types'

/** A node id: numeric once persisted, `tmp_*` while unsaved, null for "root". */
// `undefined` is part of the domain: BlockNode.id is optional until the node is
// persisted, so every lookup by id has to accept a not-yet-saved node.
type NodeId = number | string | null | undefined
import BuilderCanvas from '~/components/admin/builder/BuilderCanvas.vue'
import PropertyPanel from '~/components/admin/builder/PropertyPanel.vue'
import BlockTreeNode from '~/components/admin/builder/BlockTreeNode.vue'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const pageId = computed(() => Number(route.params.id))
const toast = useToast()
const { confirm } = useConfirm()

const registry = BLOCK_REGISTRY

/** Một mục trong bảng chọn khối — đúng phần tử `blocksByCategory()` sinh ra, nên
 *  thêm block mới vào registry là kiểu này tự theo. */
type PaletteItem = ReturnType<typeof blocksByCategory>['section'][number]
const grouped = blocksByCategory()

// Hàng từ endpoint CHI TIẾT, không phải từ danh sách: danh sách kèm thêm
// `blockCount` mà trang này không nhận, nên dùng nhầm kiểu sẽ khai một trường
// vĩnh viễn `undefined`.
const page = ref<AdminPageDetail['page'] | null>(null)
const blocks = ref<BuilderNode[]>([])
const loading = ref(true)
const loadError = ref('')

const selectedId = ref<number | string | null>(null)
const viewport = ref<'desktop' | 'tablet' | 'mobile'>('desktop')

// ── Tree helpers ─────────────────────────────────────────────────────────────
// The working copy `blocks` is a tree of nodes { id, blockType, data, isVisible,
// colSpan?, children?[] }. A legacy flat page is a list of childless root nodes.
// These walkers locate nodes/parents/sibling-arrays by id at any depth.
const findNode = (id: NodeId, list: BuilderNode[] = blocks.value): BuilderNode | null => {
  for (const n of list) {
    if (n.id === id) return n
    if (Array.isArray(n.children)) {
      const hit = findNode(id, n.children)
      if (hit) return hit
    }
  }
  return null
}
// Returns { siblings, index, parent } for the node with `id`; parent is null at root.
const locateNode = (id: NodeId, list: BuilderNode[] = blocks.value, parent: BuilderNode | null = null): NodeLocation | null => {
  const idx = list.findIndex(n => n.id === id)
  if (idx !== -1) return { siblings: list, index: idx, parent }
  for (const n of list) {
    if (Array.isArray(n.children)) {
      const hit = locateNode(id, n.children, n)
      if (hit) return hit
    }
  }
  return null
}

const selectedBlock = computed(() => (selectedId.value == null ? null : findNode(selectedId.value)))
// Index of the selected node among its own siblings (for move ▲/▼ bounds).
const selectedLoc = computed(() => (selectedId.value == null ? null : locateNode(selectedId.value)))
const selectedIndex = computed(() => selectedLoc.value?.index ?? -1)
const selectedSiblingCount = computed(() => selectedLoc.value?.siblings.length ?? 0)

// Temp ids for blocks not yet persisted to page_blocks (assigned real ids on publish).
let tmpCounter = 1
const nextTmpId = () => `tmp_${tmpCounter++}`

// Snapshot of what's actually LIVE (published), for the dirty comparison. Walks
// the whole tree so structural edits (nesting, colSpan, order) are detected.
const publishedSnapshot = ref('')
const strip = (arr: BuilderNode[]): BuilderNode[] => arr.map(b => {
  const o: BuilderNode = { blockType: b.blockType, isVisible: b.isVisible !== false, data: b.data || {} }
  if (b.blockType === 'column') o.colSpan = b.colSpan ?? 12
  if (Array.isArray(b.children)) o.children = strip(b.children)
  return o
})
const hasUnpublished = computed(() => JSON.stringify(strip(blocks.value)) !== publishedSnapshot.value)

// Draft-save network state (independent of the publish/dirty state).
type DraftStatus = 'idle' | 'saving' | 'saved' | 'error'
const draftStatus = ref<DraftStatus>('idle')
const publishing = ref(false)

// Public route the preview iframe loads ('home' → '/', others → '/<slug>').
const previewPath = computed(() => (!page.value ? '/' : page.value.slug === 'home' ? '/' : `/${page.value.slug}`))

// Recursively normalize a loaded node tree into the working-copy shape: ensure
// every node has an id (tmp for unsaved), a data object, a boolean isVisible,
// columns carry colSpan, and containers carry a (possibly empty) children array.
const hydrateNodes = (list: unknown): BuilderNode[] => (Array.isArray(list) ? list : []).map((b: BuilderNode) => {
  const node: BuilderNode = {
    ...b,
    id: b.id ?? nextTmpId(),
    data: b.data || {},
    isVisible: b.isVisible === undefined ? true : !!b.isVisible,
  }
  if (b.blockType === 'column') node.colSpan = clampColSpan(b.colSpan)
  if (isContainerType(b.blockType)) node.children = hydrateNodes(b.children || [])
  return node
})

const fetchPage = async () => {
  loading.value = true
  loadError.value = ''
  hydrating = true
  try {
    /**
     * Kiểu khai tường minh: `$fetch` suy kiểu theo **chuỗi URL**, mà URL ở đây
     * dựng động nên nó khớp nhầm sang một route khác cùng tiền tố — rồi báo là
     * `res.draft` không tồn tại trong khi endpoint có trả. Suy từ chính handler
     * thì kiểu bám vào mã máy chủ chứ không bám vào cách viết URL.
     */
    const res = await $fetch<AdminPageDetail>(`/api/admin/pages/${pageId.value}`)
    if (res.ok) {
      page.value = res.page
      // Published blocks are the live baseline for the dirty check.
      const published = hydrateNodes(res.blocks || [])
      publishedSnapshot.value = JSON.stringify(strip(published))
      // If a draft exists on the server, load it as the working copy instead.
      const draftBlocks = res.draft?.blocks
      if (Array.isArray(draftBlocks) && res.draft) {
        blocks.value = hydrateNodes(draftBlocks)
        draftStatus.value = 'saved'
      } else {
        blocks.value = published
        draftStatus.value = 'idle'
      }
      selectedId.value = blocks.value[0]?.id ?? null
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
  return d.title || d.text || d.badge || d.titleLine1 || d.html?.replace(/<[^>]+>/g, '').slice(0, 40) || '—'
}

// ── Palette / add (local only; persisted to draft) ──
// `paletteParentId` = the container the palette is adding INTO (null = root).
const showPalette = ref(false)
const adding = ref(false)
const paletteParentId = ref<NodeId>(null)

// Build a fresh node for `type`; containers start with an empty children array,
// columns with a default colSpan.
const makeNode = (type: string) => {
  const node: BuilderNode = { id: nextTmpId(), blockType: type, data: getDefaultData(type), isVisible: true }
  if (type === 'column') node.colSpan = DEFAULT_COL_SPAN
  if (isContainerType(type)) node.children = []
  return node
}

// Open the add-palette targeting a specific parent container (from the tree's
// "+" affordance), or at root level when no parent is given.
const openPalette = (parentId: NodeId = null) => {
  paletteParentId.value = parentId ?? null
  showPalette.value = true
}

// Which block groups the palette offers, filtered by the parent context:
//   root/section → section blocks + layout containers
//   row          → column only
//   column       → element (section + content) blocks only, no containers
const paletteGroups = computed<Array<{ key: string; title: string; items: PaletteItem[] }>>(() => {
  const parent = paletteParentId.value == null ? null : findNode(paletteParentId.value)
  const pType = parent?.blockType
  if (pType === 'row') {
    return [{ key: 'layout', title: 'Bố cục', items: grouped.layout.filter(i => i.type === 'column') }]
  }
  if (pType === 'column') {
    return [
      { key: 'content', title: 'Khối nội dung', items: grouped.content },
      { key: 'section', title: 'Khối trang chủ', items: grouped.section },
    ]
  }
  // root or section: section blocks + layout containers (row/section)
  return [
    { key: 'layout', title: 'Bố cục', items: grouped.layout.filter(i => i.type !== 'column') },
    { key: 'section', title: 'Khối trang chủ', items: grouped.section },
    { key: 'content', title: 'Khối nội dung', items: grouped.content },
  ]
})

// Human-readable hint of where the new block will land.
const paletteContextLabel = computed(() => {
  const parent = paletteParentId.value == null ? null : findNode(paletteParentId.value)
  if (!parent) return 'Thêm vào cấp gốc của trang.'
  const label = registry[parent.blockType]?.label || parent.blockType
  if (parent.blockType === 'row') return `Thêm Cột vào ${label}.`
  if (parent.blockType === 'column') return `Thêm nội dung vào ${label}.`
  return `Thêm vào ${label}.`
})

// Bridge injected by the recursive BlockTreeNode navigator: selection + contextual
// add. selectedId is exposed as the raw ref so children read `.value` reactively.
provide('builderTree', {
  selectedId,
  select: (id: NodeId) => { selectedId.value = id ?? null },
  openPalette,
})

const addBlock = (type: string) => {
  const node = makeNode(type)
  const parentId = paletteParentId.value
  if (parentId == null) {
    // Root: insert after the selected root node (if any), else append.
    const loc = selectedId.value != null ? locateNode(selectedId.value) : null
    if (loc && loc.parent === null) blocks.value.splice(loc.index + 1, 0, node)
    else blocks.value.push(node)
  } else {
    const parent = findNode(parentId)
    if (parent) {
      if (!Array.isArray(parent.children)) parent.children = []
      parent.children.push(node)
    } else {
      blocks.value.push(node)
    }
  }
  selectedId.value = node.id ?? null
  showPalette.value = false
  paletteParentId.value = null
  scheduleDraftSave()
  toast.success('Đã thêm block. Nhớ bấm Xuất bản để đưa lên site.')
}

// ── Duplicate (local only) — deep-clones the node and its whole subtree ──
const cloneSubtree = (node: BuilderNode): BuilderNode => {
  const copy: BuilderNode = {
    id: nextTmpId(),
    blockType: node.blockType,
    data: JSON.parse(JSON.stringify(node.data || {})),
    isVisible: node.isVisible !== false,
  }
  if (node.blockType === 'column') copy.colSpan = clampColSpan(node.colSpan)
  if (Array.isArray(node.children)) copy.children = node.children.map(cloneSubtree)
  return copy
}
const duplicateBlock = (block: BuilderNode) => {
  const loc = locateNode(block.id)
  if (!loc) return
  const copy = cloneSubtree(block)
  loc.siblings.splice(loc.index + 1, 0, copy)
  selectedId.value = copy.id ?? null
  scheduleDraftSave()
  toast.success('Đã nhân đôi block.')
}

// ── Draft auto-save (debounced) — saves the WHOLE working copy as draft JSON ──
let saveTimer: ReturnType<typeof setTimeout> | null = null
let hydrating = true // suppress draft saves during the initial load

const saveState = computed(() => {
  if (publishing.value) return { text: 'Đang xuất bản…', icon: 'fa-solid fa-spinner fa-spin', color: 'text-gray-500' }
  if (draftStatus.value === 'saving') return { text: 'Đang lưu nháp…', icon: 'fa-solid fa-spinner fa-spin', color: 'text-gray-500' }
  if (draftStatus.value === 'error') return { text: 'Lỗi lưu nháp', icon: 'fa-solid fa-triangle-exclamation', color: 'text-red-600' }
  if (hasUnpublished.value) return { text: 'Nháp — chưa xuất bản', icon: 'fa-solid fa-pen', color: 'text-orange-500' }
  return { text: 'Đã xuất bản', icon: 'fa-solid fa-circle-check', color: 'text-green-600' }
})

const scheduleDraftSave = () => {
  if (hydrating) return
  draftStatus.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveDraft, 800)
}

// Recursively serialize the working tree for draft/publish/version payloads.
// Preserves nesting (children), column widths (colSpan), and per-level order.
const serializeNodes = (list: BuilderNode[]): BlockNode[] => list.map((b, i) => {
  const out: BlockNode = {
    id: typeof b.id === 'number' ? b.id : undefined,
    blockType: b.blockType,
    displayOrder: i + 1,
    data: b.data || {},
    isVisible: b.isVisible !== false,
  }
  if (b.blockType === 'column') out.colSpan = clampColSpan(b.colSpan)
  if (Array.isArray(b.children)) out.children = serializeNodes(b.children)
  return out
})
const draftPayload = () => serializeNodes(blocks.value)

const saveDraft = async () => {
  draftStatus.value = 'saving'
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/draft`, { method: 'PUT', body: { blocks: draftPayload() } })
    draftStatus.value = 'saved'
  } catch (err: unknown) {
    draftStatus.value = 'error'
    toast.error(errorMessage(err, 'Không lưu được nháp.'))
  }
}

// Deep-watch the whole working copy → debounce a draft save.
watch(blocks, () => scheduleDraftSave(), { deep: true })

// ── Publish: push draft → live, create an auto version, clear draft ──
const publish = async () => {
  if (publishing.value) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  publishing.value = true
  try {
    const res = await $fetch(`/api/admin/pages/${pageId.value}/publish`, { method: 'POST', body: { blocks: draftPayload() } })
    if (res.ok) {
      const prevSelected = selectedId.value
      hydrating = true
      blocks.value = hydrateNodes(res.blocks || [])
      publishedSnapshot.value = JSON.stringify(strip(blocks.value))
      draftStatus.value = 'idle'
      // Keep the same node selected if it survived (real ids are stable on flat
      // pages); otherwise fall back to the first root node.
      selectedId.value = (prevSelected != null && findNode(prevSelected)) ? prevSelected : (blocks.value[0]?.id ?? null)
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
  const ok = await confirm({ title: 'Hủy thay đổi', message: 'Bỏ toàn bộ chỉnh sửa chưa xuất bản và quay lại bản đang chạy trên site?', danger: true, confirmLabel: 'Hủy thay đổi' })
  if (!ok) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  hydrating = true
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/draft`, { method: 'PUT', body: {} }) // clears draft → null
    await fetchPage() // reloads published (no draft present) and resets hydration flag
    toast.success('Đã quay lại bản đang chạy.')
  } catch (err: unknown) {
    hydrating = false
    toast.error(errorMessage(err, 'Không hủy được thay đổi.'))
  }
}

// ── Visibility (local) ──
const toggleVisible = (block: BuilderNode) => {
  block.isVisible = !block.isVisible
  scheduleDraftSave()
}

// ── Delete (local) — removes the node (and its subtree) from its own parent ──
const removeBlock = async (block: BuilderNode) => {
  const ok = await confirm({ title: 'Xóa block', message: `Xóa block "${registry[block.blockType]?.label || block.blockType}"?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  const loc = locateNode(block.id)
  if (!loc) return
  loc.siblings.splice(loc.index, 1)
  if (selectedId.value === block.id) {
    // Prefer a remaining sibling, else the parent, else the first root node.
    const sib = loc.siblings[loc.index] ?? loc.siblings[loc.index - 1]
    selectedId.value = sib?.id ?? loc.parent?.id ?? blocks.value[0]?.id ?? null
  }
  scheduleDraftSave()
  toast.success('Đã xóa block khỏi bản nháp.')
}

// ── Reorder (arrows in canvas / property panel) — within the node's own siblings ──
// `index` is the node's index among its siblings; move swaps within that array so
// nesting is preserved.
const move = (index: number, dir: number) => {
  if (selectedId.value == null) return
  const loc = locateNode(selectedId.value)
  if (!loc) return
  const arr = loc.siblings
  const from = loc.index
  const target = from + dir
  if (target < 0 || target >= arr.length) return
  const a = arr[from]
  const b = arr[target]
  if (a === undefined || b === undefined) return
  arr[from] = b
  arr[target] = a
  scheduleDraftSave()
}

// ── Meta ──
const showMeta = ref(false)
const savingMeta = ref(false)
const metaForm = reactive({ title: '', slug: '', seoTitle: '', seoDescription: '' })
const openMeta = () => {
  metaForm.title = page.value?.title || ''
  metaForm.slug = page.value?.slug || ''
  metaForm.seoTitle = page.value?.seoTitle || ''
  metaForm.seoDescription = page.value?.seoDescription || ''
  showMeta.value = true
}
const saveMeta = async () => {
  savingMeta.value = true
  try {
    const body: Record<string, unknown> = { title: metaForm.title, seoTitle: metaForm.seoTitle, seoDescription: metaForm.seoDescription }
    if (!page.value?.isSystem) body.slug = metaForm.slug
    const res = await $fetch<AdminPageUpdateResult>(`/api/admin/pages/${pageId.value}`, { method: 'PUT', body })
    // `page.value` đọc lại sau `await`: điều hướng khỏi trang giữa lúc lưu sẽ
    // gỡ nó về null, và gán vào null là một lỗi thật chứ không phải giả định.
    if (res.ok && page.value) {
      page.value.title = metaForm.title
      page.value.slug = res.slug
      page.value.seoTitle = metaForm.seoTitle
      page.value.seoDescription = metaForm.seoDescription
      toast.success('Đã lưu cấu hình trang.')
      showMeta.value = false
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không lưu được cấu hình.'))
  } finally {
    savingMeta.value = false
  }
}

// ── Versions ──
const showVersions = ref(false)
const versions = ref<any[]>([])
const versionsLoading = ref(false)
const savingBackup = ref(false)
const backupLabel = ref('')

const kindMeta: Record<string, { label: string; icon: string; color: string }> = {
  origin: { label: 'Bản gốc', icon: 'fa-solid fa-anchor', color: 'text-blue-600' },
  manual: { label: 'Bản sao lưu', icon: 'fa-solid fa-bookmark', color: 'text-green-700' },
  auto: { label: 'Tự động', icon: 'fa-solid fa-clock-rotate-left', color: 'text-gray-500' },
}
const manualCount = computed(() => versions.value.filter(v => v.kind === 'manual').length)
const hasOrigin = computed(() => versions.value.some(v => v.kind === 'origin'))

const openVersions = async () => {
  showVersions.value = true
  await loadVersions()
}
const loadVersions = async () => {
  versionsLoading.value = true
  try {
    const res = await $fetch(`/api/admin/pages/${pageId.value}/versions`)
    if (res.ok) versions.value = res.versions || []
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không tải được danh sách phiên bản.'))
  } finally {
    versionsLoading.value = false
  }
}

// Load a version into the working copy (draft) — user must Publish to go live.
const restoreVersion = async (v: PageVersionRow) => {
  const ok = await confirm({ title: 'Khôi phục phiên bản', message: `Nạp "${v.label || kindMeta[v.kind]?.label}" vào bản nháp? Bản đang chạy trên site không đổi cho tới khi bạn Xuất bản.`, confirmLabel: 'Khôi phục' })
  if (!ok) return
  try {
    const res = await $fetch(`/api/admin/pages/${pageId.value}/versions/${v.id}/restore`, { method: 'POST' })
    if (res.ok) {
      hydrating = true
      blocks.value = hydrateNodes(res.blocks || [])
      selectedId.value = blocks.value[0]?.id ?? null
      draftStatus.value = 'saved'
      nextTick(() => { hydrating = false })
      showVersions.value = false
      toast.success('Đã nạp vào bản nháp. Xem trước rồi bấm Xuất bản.')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không khôi phục được.'))
  }
}

const deleteVersion = async (v: PageVersionRow) => {
  const ok = await confirm({ title: 'Xóa phiên bản', message: `Xóa "${v.label || kindMeta[v.kind]?.label}"?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/versions/${v.id}`, { method: 'DELETE' })
    await loadVersions()
    toast.success('Đã xóa phiên bản.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xóa được phiên bản.'))
  }
}

// Save current working copy as a named manual backup (max 4).
const saveBackup = async () => {
  savingBackup.value = true
  try {
    const res = await $fetch(`/api/admin/pages/${pageId.value}/versions`, { method: 'POST', body: { kind: 'manual', label: backupLabel.value, blocks: draftPayload() } })
    if (res.ok) {
      backupLabel.value = ''
      await loadVersions()
      toast.success('Đã lưu bản sao lưu.')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không lưu được bản sao lưu.'))
  } finally {
    savingBackup.value = false
  }
}

// Designate the current working copy as the locked origin baseline.
const setOrigin = async () => {
  const ok = await confirm({ title: 'Chỉ định bản gốc', message: hasOrigin.value ? 'Ghi đè bản gốc hiện tại bằng nội dung đang dựng?' : 'Đặt nội dung đang dựng làm bản gốc (khóa, dùng để khôi phục sau này)?', confirmLabel: 'Chỉ định' })
  if (!ok) return
  try {
    const res = await $fetch(`/api/admin/pages/${pageId.value}/versions`, { method: 'POST', body: { kind: 'origin', blocks: draftPayload() } })
    if (res.ok) {
      await loadVersions()
      toast.success('Đã chỉ định bản gốc.')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không chỉ định được bản gốc.'))
  }
}

const fmtDate = (d: string) => {
  if (!d) return ''
  try { return new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return d }
}

onMounted(fetchPage)
</script>

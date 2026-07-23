<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { hasPermission } = useAdminAuth()
const canEdit = computed(() => hasPermission('settings', 'update'))

type ChildItem = { id: string; label: string; url: string; openNewTab: boolean }
type MenuItem = { id: string; label: string; url: string; openNewTab: boolean; children: ChildItem[] }

const menu = ref<MenuItem[]>([])
const loading = ref(true)
const saving = ref(false)

// Default menu as fallback reference
const DEFAULT_MENU: MenuItem[] = [
  { id: 'home', label: 'Trang chủ', url: '/', openNewTab: false, children: [] },
  { id: 'about', label: 'Giới thiệu', url: '/about', openNewTab: false, children: [] },
  {
    id: 'news', label: 'Bản tin', url: '/news', openNewTab: false,
    children: [
      { id: 'news-featured', label: 'Tin nổi bật', url: '/news/featured-news', openNewTab: false },
      { id: 'news-activity', label: 'Tin hoạt động', url: '/news/activity-news', openNewTab: false },
      { id: 'news-local', label: 'Tin địa phương', url: '/news/local-news', openNewTab: false },
    ]
  },
  { id: 'role-models', label: 'Tấm gương tiêu biểu', url: '/role-models', openNewTab: false, children: [] },
  { id: 'reintegration', label: 'Mô hình tái hòa nhập', url: '/reintegration-models', openNewTab: false, children: [] },
  { id: 'documents', label: 'Văn bản pháp luật', url: '/documents', openNewTab: false, children: [] },
  { id: 'legal-qa', label: 'Giải đáp pháp luật', url: '/legal-qa', openNewTab: false, children: [] },
  { id: 'contact', label: 'Liên hệ', url: '/contact', openNewTab: false, children: [] },
]

function uid() { return Math.random().toString(36).slice(2, 10) }

async function loadMenu() {
  loading.value = true
  try {
    const res = await $fetch<{ ok: boolean; menu: MenuItem[] | null }>('/api/admin/settings/navigation')
    if (res.ok && Array.isArray(res.menu) && res.menu.length) {
      menu.value = res.menu.map(item => ({
        ...item,
        children: Array.isArray(item.children) ? item.children : [],
      }))
    } else {
      menu.value = DEFAULT_MENU.map(item => ({ ...item, children: item.children.map(c => ({ ...c })) }))
    }
  } catch {
    toast.error('Không thể tải cấu hình menu')
    menu.value = DEFAULT_MENU.map(item => ({ ...item, children: item.children.map(c => ({ ...c })) }))
  } finally {
    loading.value = false
  }
}

async function saveMenu() {
  saving.value = true
  try {
    await $fetch('/api/admin/settings/navigation', { method: 'PUT', body: { menu: menu.value } })
    toast.success('Đã lưu cấu hình menu thành công!')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu menu')
  } finally {
    saving.value = false
  }
}

function resetToDefault() {
  menu.value = DEFAULT_MENU.map(item => ({ ...item, children: item.children.map(c => ({ ...c })) }))
  toast.info('Đã khôi phục menu mặc định — nhớ bấm Lưu để áp dụng')
}

// Top-level item management
function addItem() {
  menu.value.push({ id: uid(), label: 'Mục mới', url: '/', openNewTab: false, children: [] })
}
function removeItem(idx: number) {
  menu.value.splice(idx, 1)
}
function moveItem(idx: number, dir: -1 | 1) {
  const to = idx + dir
  if (to < 0 || to >= menu.value.length) return
  const arr = [...menu.value];
  [arr[idx], arr[to]] = [arr[to], arr[idx]]
  menu.value = arr
}

// Child item management
function addChild(parentIdx: number) {
  menu.value[parentIdx].children.push({ id: uid(), label: 'Mục con mới', url: '/', openNewTab: false })
}
function removeChild(parentIdx: number, childIdx: number) {
  menu.value[parentIdx].children.splice(childIdx, 1)
}
function moveChild(parentIdx: number, childIdx: number, dir: -1 | 1) {
  const arr = menu.value[parentIdx].children
  const to = childIdx + dir
  if (to < 0 || to >= arr.length) return;
  [arr[childIdx], arr[to]] = [arr[to], arr[childIdx]]
}

// Expanded state for children editor
const expanded = ref<Set<string>>(new Set())
function toggleExpanded(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  // force reactivity
  expanded.value = new Set(expanded.value)
}

onMounted(loadMenu)
</script>

<template>
  <div class="flex flex-col gap-6 max-w-3xl">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-[1.25rem] font-extrabold text-[#122815] m-0">Quản lý Menu Điều hướng</h1>
        <p class="text-[0.82rem] text-[#667768] mt-1 m-0">Cấu hình các mục menu header và mobile menu của website public.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-4 py-2 text-sm font-semibold text-[#667768] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
          @click="resetToDefault"
        >
          <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          Khôi phục mặc định
        </button>
        <button
          v-if="canEdit"
          type="button"
          :disabled="saving"
          class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white hover:bg-[#245b2a] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2"
          @click="saveMenu"
        >
          <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'" aria-hidden="true"></i>
          {{ saving ? 'Đang lưu…' : 'Lưu cấu hình' }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center gap-3 rounded-xl border border-[#e2ece3] bg-white p-8 text-[#667768] text-sm">
      <i class="fa-solid fa-spinner fa-spin text-[#2c6e33]" aria-hidden="true"></i>
      Đang tải cấu hình menu…
    </div>

    <template v-else>
      <!-- Menu items list -->
      <div class="flex flex-col gap-3">
        <div
          v-for="(item, idx) in menu"
          :key="item.id"
          class="rounded-xl border border-[#e2ece3] bg-white shadow-sm overflow-hidden"
        >
          <!-- Item header row -->
          <div class="flex items-center gap-3 px-4 py-3 bg-[#fafcfa]">
            <!-- Sort buttons -->
            <div class="flex flex-col gap-0.5 shrink-0">
              <button type="button" :disabled="idx === 0" class="w-6 h-5 flex items-center justify-center rounded text-[#667768] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveItem(idx, -1)" aria-label="Lên trên">
                <i class="fa-solid fa-chevron-up text-[0.6rem]" aria-hidden="true"></i>
              </button>
              <button type="button" :disabled="idx === menu.length - 1" class="w-6 h-5 flex items-center justify-center rounded text-[#667768] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveItem(idx, 1)" aria-label="Xuống dưới">
                <i class="fa-solid fa-chevron-down text-[0.6rem]" aria-hidden="true"></i>
              </button>
            </div>

            <!-- Label + URL fields -->
            <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
              <input
                v-model="item.label"
                type="text"
                placeholder="Nhãn hiển thị"
                maxlength="80"
                class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#122815] font-semibold focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
                :disabled="!canEdit"
              />
              <input
                v-model="item.url"
                type="text"
                placeholder="URL (vd: /about hoặc https://...)"
                maxlength="512"
                class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#334e36] font-mono focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
                :disabled="!canEdit"
              />
            </div>

            <!-- Options -->
            <label class="flex items-center gap-1.5 text-xs text-[#667768] shrink-0 cursor-pointer select-none" :title="'Mở tab mới'">
              <input type="checkbox" v-model="item.openNewTab" :disabled="!canEdit" class="w-3.5 h-3.5 accent-[#2c6e33]" />
              <span class="hidden sm:inline">Tab mới</span>
            </label>

            <!-- Children toggle -->
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-[#e2ece3] px-2.5 py-1.5 text-xs font-semibold text-[#334e36] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] shrink-0"
              :class="expanded.has(item.id) ? 'bg-[#f0f7f1] border-[#8ed694]' : ''"
              @click="toggleExpanded(item.id)"
              :aria-expanded="expanded.has(item.id)"
            >
              <i class="fa-solid fa-sitemap text-[0.65rem]" aria-hidden="true"></i>
              <span>{{ item.children.length ? `${item.children.length} con` : 'Sub-menu' }}</span>
              <i class="fa-solid text-[0.6rem]" :class="expanded.has(item.id) ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true"></i>
            </button>

            <!-- Delete -->
            <button
              v-if="canEdit"
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 shrink-0"
              @click="removeItem(idx)"
              aria-label="Xóa mục menu"
            >
              <i class="fa-solid fa-trash text-xs" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Children panel -->
          <div v-if="expanded.has(item.id)" class="border-t border-[#e2ece3] px-4 py-3 bg-white">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[0.75rem] font-bold text-[#667768] uppercase tracking-wide">Mục con (dropdown)</span>
              <button
                v-if="canEdit"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg bg-[#f0f7f1] border border-[#e2ece3] px-2.5 py-1 text-xs font-bold text-[#2c6e33] hover:bg-[#e2f0e3] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
                @click="addChild(idx)"
              >
                <i class="fa-solid fa-plus text-[0.6rem]" aria-hidden="true"></i>
                Thêm mục con
              </button>
            </div>

            <div v-if="item.children.length === 0" class="text-xs text-[#afc8b1] py-2">
              Không có mục con. Bấm "Thêm mục con" để tạo dropdown.
            </div>

            <div class="flex flex-col gap-2">
              <div v-for="(child, cidx) in item.children" :key="child.id" class="flex items-center gap-2 rounded-lg bg-[#f7fbf7] border border-[#e2ece3] px-3 py-2">
                <div class="flex flex-col gap-0.5 shrink-0">
                  <button type="button" :disabled="cidx === 0" class="w-5 h-4 flex items-center justify-center rounded text-[#8ea98f] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveChild(idx, cidx, -1)" aria-label="Lên trên">
                    <i class="fa-solid fa-chevron-up text-[0.5rem]" aria-hidden="true"></i>
                  </button>
                  <button type="button" :disabled="cidx === item.children.length - 1" class="w-5 h-4 flex items-center justify-center rounded text-[#8ea98f] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveChild(idx, cidx, 1)" aria-label="Xuống dưới">
                    <i class="fa-solid fa-chevron-down text-[0.5rem]" aria-hidden="true"></i>
                  </button>
                </div>
                <input
                  v-model="child.label"
                  type="text"
                  placeholder="Nhãn mục con"
                  maxlength="80"
                  class="flex-1 min-w-0 px-2.5 py-1 rounded-lg border border-[#dce8dd] text-sm font-semibold text-[#122815] focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
                  :disabled="!canEdit"
                />
                <input
                  v-model="child.url"
                  type="text"
                  placeholder="URL"
                  maxlength="512"
                  class="flex-1 min-w-0 px-2.5 py-1 rounded-lg border border-[#dce8dd] text-sm font-mono text-[#334e36] focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
                  :disabled="!canEdit"
                />
                <label class="flex items-center gap-1 text-xs text-[#667768] shrink-0 cursor-pointer">
                  <input type="checkbox" v-model="child.openNewTab" :disabled="!canEdit" class="w-3 h-3 accent-[#2c6e33]" />
                  <span class="hidden sm:inline text-[0.7rem]">Tab mới</span>
                </label>
                <button
                  v-if="canEdit"
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600 focus:outline-none shrink-0"
                  @click="removeChild(idx, cidx)"
                  aria-label="Xóa mục con"
                >
                  <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Add item button -->
      <button
        v-if="canEdit"
        type="button"
        class="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#afc8b1] bg-white px-5 py-3.5 text-sm font-bold text-[#2c6e33] hover:border-[#2c6e33] hover:bg-[#f0f7f1] transition focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
        @click="addItem"
      >
        <i class="fa-solid fa-plus" aria-hidden="true"></i>
        Thêm mục menu
      </button>

      <!-- Preview hint -->
      <div class="rounded-xl border border-[#e2ece3] bg-[#f7fbf7] p-4 text-[0.82rem] text-[#667768]">
        <i class="fa-solid fa-circle-info text-[#2c6e33] mr-2" aria-hidden="true"></i>
        Sau khi lưu, menu sẽ được cập nhật trên website public ngay lập tức. Mục có <strong>sub-menu</strong> sẽ hiển thị dạng dropdown trên desktop và accordion trên mobile.
      </div>
    </template>
  </div>
</template>

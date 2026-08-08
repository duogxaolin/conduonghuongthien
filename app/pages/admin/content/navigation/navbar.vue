<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { hasPermission } = useAdminAuth()
const canEdit = computed(() => hasPermission('settings', 'update'))

type ChildItem = { id: string; label: string; url: string; openNewTab: boolean }
type MenuItem = { id: string; label: string; url: string; openNewTab: boolean; children: ChildItem[] }

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

const menu = ref<MenuItem[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)

function uid() { return Math.random().toString(36).slice(2, 10) }

async function loadMenu() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ ok: boolean; menu: MenuItem[] | null }>('/api/admin/settings/navigation/navbar')
    if (res.ok && Array.isArray(res.menu) && res.menu.length) {
      menu.value = res.menu.map(item => ({ ...item, children: Array.isArray(item.children) ? item.children : [] }))
    } else {
      menu.value = DEFAULT_MENU.map(item => ({ ...item, children: item.children.map(c => ({ ...c })) }))
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được cấu hình menu navbar.')
    menu.value = DEFAULT_MENU.map(item => ({ ...item, children: item.children.map(c => ({ ...c })) }))
  } finally {
    loading.value = false
  }
}

async function saveMenu() {
  saving.value = true
  try {
    await $fetch('/api/admin/settings/navigation/navbar', { method: 'PUT', body: { menu: menu.value } })
    toast.success('Đã lưu cấu hình navbar thành công!')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu menu'))
  } finally {
    saving.value = false
  }
}

function resetToDefault() {
  menu.value = DEFAULT_MENU.map(item => ({ ...item, children: item.children.map(c => ({ ...c })) }))
  toast.info('Đã khôi phục menu mặc định — nhớ bấm Lưu để áp dụng')
}

function addItem() {
  menu.value.push({ id: uid(), label: 'Mục mới', url: '/', openNewTab: false, children: [] })
}
function removeItem(idx: number) { menu.value.splice(idx, 1) }
function swap<T>(arr: T[], a: number, b: number) {
  const left = arr[a]
  const right = arr[b]
  if (left === undefined || right === undefined) return
  arr[a] = right
  arr[b] = left
}
function moveItem(idx: number, dir: -1 | 1) {
  const to = idx + dir
  if (to < 0 || to >= menu.value.length) return
  const arr = [...menu.value]
  swap(arr, idx, to)
  menu.value = arr
}

function addChild(parentIdx: number) {
  menu.value[parentIdx]?.children.push({ id: uid(), label: 'Mục con mới', url: '/', openNewTab: false })
}
function removeChild(parentIdx: number, childIdx: number) {
  menu.value[parentIdx]?.children.splice(childIdx, 1)
}
function moveChild(parentIdx: number, childIdx: number, dir: -1 | 1) {
  const arr = menu.value[parentIdx]?.children
  if (!arr) return
  const to = childIdx + dir
  if (to < 0 || to >= arr.length) return
  swap(arr, childIdx, to)
}

const expanded = ref<Set<string>>(new Set())
function toggleExpanded(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}

// Preview: which dropdown is currently hovered/open
const previewOpen = ref<string | null>(null)

onMounted(loadMenu)
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[0.78rem] font-bold text-[#2c6e33]">Menu chính (Navbar + ☰)</span>
          <span class="text-[#c8d6c9] text-xs">|</span>
          <nuxt-link to="/admin/content/navigation/mobile" class="text-[0.78rem] text-[#667768] hover:text-[#2c6e33] font-medium">Thanh nổi dưới (Mobile)</nuxt-link>
        </div>
        <h1 class="text-[1.25rem] font-extrabold text-[#122815] m-0">Menu chính (Navbar + Hamburger)</h1>
        <p class="text-[0.82rem] text-[#667768] mt-1 m-0">Dùng chung cho cả thanh menu ngang trên desktop và menu ☰ (hamburger drawer) trên mobile. Sửa một lần, cả hai cùng đổi.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-4 py-2 text-sm font-semibold text-[#667768] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="resetToDefault">
          <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          Khôi phục mặc định
        </button>
        <button v-if="canEdit" type="button" :disabled="saving" class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white hover:bg-[#245b2a] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2" @click="saveMenu">
          <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'" aria-hidden="true"></i>
          {{ saving ? 'Đang lưu…' : 'Lưu cấu hình' }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start" role="status" aria-busy="true">
      <span class="sr-only">Đang tải cấu hình menu</span>
      <div class="flex flex-col gap-3" aria-hidden="true">
        <div class="h-3 w-48 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
        <div
          v-for="n in 5"
          :key="'nv-' + n"
          class="rounded-xl border border-[#e2ece3] bg-white shadow-sm overflow-hidden"
        >
          <div class="flex items-center gap-3 px-4 py-3 bg-[#fafcfa]">
            <div class="w-6 h-11 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none shrink-0"></div>
            <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
              <div class="h-8 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
              <div class="h-8 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
            </div>
            <div class="h-8 w-24 rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none shrink-0"></div>
          </div>
        </div>
      </div>
      <div class="rounded-xl border border-[#e2ece3] bg-white p-4 flex flex-col gap-3" aria-hidden="true">
        <div class="h-3 w-40 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
        <div class="h-[220px] w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="loadMenu()">thử lại</button>.
    </div>

    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        <!-- ============ LEFT: config ============ -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2 text-[0.72rem] font-bold text-[#667768] uppercase tracking-wide">
            <i class="fa-solid fa-sliders text-[#2c6e33]" aria-hidden="true"></i>
            Cấu hình các mục menu
          </div>

          <div
            v-for="(item, idx) in menu"
            :key="item.id"
            class="rounded-xl border border-[#e2ece3] bg-white shadow-sm overflow-hidden"
          >
            <!-- Item header row -->
            <div class="flex items-center gap-3 px-4 py-3 bg-[#fafcfa]">
              <div class="flex flex-col gap-0.5 shrink-0">
                <button type="button" :disabled="idx === 0" class="w-6 h-5 flex items-center justify-center rounded text-[#667768] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveItem(idx, -1)" aria-label="Lên trên">
                  <i class="fa-solid fa-chevron-up text-[0.6rem]" aria-hidden="true"></i>
                </button>
                <button type="button" :disabled="idx === menu.length - 1" class="w-6 h-5 flex items-center justify-center rounded text-[#667768] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveItem(idx, 1)" aria-label="Xuống dưới">
                  <i class="fa-solid fa-chevron-down text-[0.6rem]" aria-hidden="true"></i>
                </button>
              </div>
              <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                <input v-model="item.label" type="text" placeholder="Nhãn hiển thị" maxlength="80" class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#122815] font-semibold focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" :disabled="!canEdit" />
                <input v-model="item.url" type="text" placeholder="URL (vd: /about)" maxlength="512" class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#334e36] font-mono focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" :disabled="!canEdit" />
              </div>
              <label class="flex items-center gap-1.5 text-xs text-[#667768] shrink-0 cursor-pointer select-none">
                <input type="checkbox" v-model="item.openNewTab" :disabled="!canEdit" class="w-3.5 h-3.5 accent-[#2c6e33]" />
                <span class="hidden sm:inline">Tab mới</span>
              </label>
              <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-[#e2ece3] px-2.5 py-1.5 text-xs font-semibold text-[#334e36] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] shrink-0" :class="expanded.has(item.id) ? 'bg-[#f0f7f1] border-[#8ed694]' : ''" @click="toggleExpanded(item.id)" :aria-expanded="expanded.has(item.id)">
                <i class="fa-solid fa-sitemap text-[0.65rem]" aria-hidden="true"></i>
                <span>{{ item.children.length ? `${item.children.length} con` : 'Dropdown' }}</span>
                <i class="fa-solid text-[0.6rem]" :class="expanded.has(item.id) ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true"></i>
              </button>
              <button v-if="canEdit" type="button" class="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 shrink-0" @click="removeItem(idx)" aria-label="Xóa mục">
                <i class="fa-solid fa-trash text-xs" aria-hidden="true"></i>
              </button>
            </div>

            <!-- Children panel -->
            <div v-if="expanded.has(item.id)" class="border-t border-[#e2ece3] px-4 py-3 bg-white">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[0.75rem] font-bold text-[#667768] uppercase tracking-wide">Mục con (dropdown)</span>
                <button v-if="canEdit" type="button" class="inline-flex items-center gap-1.5 rounded-lg bg-[#f0f7f1] border border-[#e2ece3] px-2.5 py-1 text-xs font-bold text-[#2c6e33] hover:bg-[#e2f0e3] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="addChild(idx)">
                  <i class="fa-solid fa-plus text-[0.6rem]" aria-hidden="true"></i>
                  Thêm mục con
                </button>
              </div>
              <div v-if="item.children.length === 0" class="text-xs text-[#afc8b1] py-2">Không có mục con. Bấm "Thêm mục con" để tạo dropdown.</div>
              <div class="flex flex-col gap-2">
                <div v-for="(child, cidx) in item.children" :key="child.id" class="flex items-center gap-2 rounded-lg bg-[#f7fbf7] border border-[#e2ece3] px-3 py-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button type="button" :disabled="cidx === 0" class="w-5 h-4 flex items-center justify-center rounded text-[#8ea98f] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveChild(idx, cidx, -1)">
                      <i class="fa-solid fa-chevron-up text-[0.5rem]" aria-hidden="true"></i>
                    </button>
                    <button type="button" :disabled="cidx === item.children.length - 1" class="w-5 h-4 flex items-center justify-center rounded text-[#8ea98f] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveChild(idx, cidx, 1)">
                      <i class="fa-solid fa-chevron-down text-[0.5rem]" aria-hidden="true"></i>
                    </button>
                  </div>
                  <input v-model="child.label" type="text" placeholder="Nhãn mục con" maxlength="80" class="flex-1 min-w-0 px-2.5 py-1 rounded-lg border border-[#dce8dd] text-sm font-semibold text-[#122815] focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" :disabled="!canEdit" />
                  <input v-model="child.url" type="text" placeholder="URL" maxlength="512" class="flex-1 min-w-0 px-2.5 py-1 rounded-lg border border-[#dce8dd] text-sm font-mono text-[#334e36] focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" :disabled="!canEdit" />
                  <button v-if="canEdit" type="button" class="w-7 h-7 flex items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600 focus:outline-none shrink-0" @click="removeChild(idx, cidx)">
                    <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button v-if="canEdit" type="button" class="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#afc8b1] bg-white px-5 py-3.5 text-sm font-bold text-[#2c6e33] hover:border-[#2c6e33] hover:bg-[#f0f7f1] transition focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="addItem">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            Thêm mục menu
          </button>
        </div>

        <!-- ============ RIGHT: live website preview ============ -->
        <div class="flex flex-col gap-3 xl:sticky xl:top-6">
          <div class="flex items-center gap-2 text-[0.72rem] font-bold text-[#667768] uppercase tracking-wide">
            <i class="fa-solid fa-eye text-[#2c6e33]" aria-hidden="true"></i>
            Xem trước website (desktop)
          </div>

          <!-- Browser window mockup -->
          <div class="rounded-xl border border-[#d7e3d8] bg-white shadow-lg overflow-hidden">
            <!-- Browser chrome -->
            <div class="flex items-center gap-2 px-3 py-2 bg-[#eef1ee] border-b border-[#dce8dd]">
              <span class="w-3 h-3 rounded-full bg-[#ff5f57] inline-block"></span>
              <span class="w-3 h-3 rounded-full bg-[#febc2e] inline-block"></span>
              <span class="w-3 h-3 rounded-full bg-[#28c840] inline-block"></span>
              <span class="ml-3 flex-1 flex items-center gap-1.5 text-[0.68rem] text-[#7c8c7d] bg-white rounded-md px-2.5 py-1 border border-[#dce8dd] font-mono">
                <i class="fa-solid fa-lock text-[0.55rem] text-[#8ea98f]" aria-hidden="true"></i>
              </span>
            </div>

            <!-- ===== Real website header replica ===== -->
            <div class="bg-white">
              <!-- Top bar -->
              <div class="bg-[#385130] text-white px-4 py-1.5 text-[0.62rem] flex justify-between items-center">
                <span><i class="fa-solid fa-phone" aria-hidden="true"></i> Hotline: 0903.480.985</span>
                <div class="flex items-center gap-1">
                  <span class="px-1.5 py-0.5 rounded bg-[#4A6741] font-semibold">VN</span>
                  <span class="px-1.5 py-0.5 text-white/60 font-semibold">EN</span>
                </div>
              </div>

              <!-- Logo row -->
              <div class="border-b border-[#E2E8DF] px-4 py-2.5 flex justify-between items-center">
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-full bg-[#e4f0e2] flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-shield-halved text-[#4A6741] text-sm" aria-hidden="true"></i>
                  </div>
                  <div class="leading-tight">
                    <div class="text-[0.72rem] font-extrabold text-[#4A6741] tracking-wide">CON ĐƯỜNG HƯỚNG THIỆN</div>
                    <div class="text-[0.5rem] font-semibold text-[#7A8675] uppercase">Cổng thông tin điện tử — Bộ Công an</div>
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-7 h-7 rounded-full bg-[#F8FAF7] border border-[#E2E8DF] flex items-center justify-center text-[#4A6741] text-[0.65rem]">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                  </span>
                  <span class="inline-flex items-center gap-1 bg-[#4A6741] text-white text-[0.58rem] font-bold px-2.5 py-1.5 rounded-sm">
                    <i class="fa-solid fa-headset" aria-hidden="true"></i> Hỗ trợ 24/7
                  </span>
                </div>
              </div>

              <!-- Horizontal nav bar (the thing being configured) -->
              <div class="bg-white border-b border-[#e1e8e0] px-2 min-h-[38px] flex items-center relative">
                <ul class="flex list-none w-full items-center gap-0 flex-wrap">
                  <li
                    v-for="item in menu"
                    :key="item.id"
                    class="relative"
                    @mouseenter="item.children && item.children.length ? previewOpen = item.id : null"
                    @mouseleave="previewOpen = null"
                  >
                    <div class="flex items-center gap-1 text-[#1e4620] font-bold text-[0.66rem] px-2 py-2 rounded-md whitespace-nowrap cursor-default select-none transition-all hover:bg-[#f0f6ef] hover:text-[#143516]">
                      {{ item.label || '(trống)' }}
                      <i v-if="item.children && item.children.length" class="fa-solid fa-chevron-down text-[0.45rem] text-[#557757] transition-transform duration-200" :class="{ 'rotate-180': previewOpen === item.id }" aria-hidden="true"></i>
                    </div>
                    <!-- Dropdown -->
                    <ul
                      v-if="item.children && item.children.length"
                      class="absolute top-full left-0 z-20 mt-1 min-w-[150px] list-none bg-white rounded-lg border border-[rgba(30,70,32,0.12)] shadow-[0_14px_36px_rgba(15,35,18,0.18)] p-1.5 transition-all duration-150"
                      :class="previewOpen === item.id ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-1 pointer-events-none'"
                    >
                      <li v-for="child in item.children" :key="child.id">
                        <div class="px-2.5 py-1.5 text-[#2d4a2d] text-[0.62rem] font-semibold rounded-md hover:bg-[rgba(30,70,32,0.07)] hover:text-[#1e4620] whitespace-nowrap cursor-default">
                          {{ child.label || '(trống)' }}
                        </div>
                      </li>
                    </ul>
                  </li>
                </ul>
                <span v-if="!menu.length" class="text-[0.62rem] text-[#afc8b1] italic px-2">Chưa có mục nào — thêm ở cột trái</span>
              </div>

              <!-- Fake page body -->
              <div class="p-4 bg-[#f8faf7] space-y-2">
                <div class="h-16 rounded-lg bg-gradient-to-r from-[#e4f0e2] to-[#f0f6ef] flex items-center justify-center">
                  <span class="text-[0.6rem] text-[#8ea98f] italic">Nội dung trang chủ</span>
                </div>
                <div class="grid grid-cols-3 gap-2">
                  <div class="h-10 rounded bg-[#eef4ed]"></div>
                  <div class="h-10 rounded bg-[#eef4ed]"></div>
                  <div class="h-10 rounded bg-[#eef4ed]"></div>
                </div>
              </div>
            </div>
          </div>

          <p class="text-[0.7rem] text-[#afc8b1] m-0 flex items-center gap-1.5">
            <i class="fa-solid fa-arrow-pointer" aria-hidden="true"></i>
            Rê chuột vào mục có dropdown để xem menu con. Preview cập nhật theo thời gian thực.
          </p>

          <!-- Info note -->
          <div class="rounded-xl border border-[#e2ece3] bg-[#f7fbf7] p-3.5 text-[0.78rem] text-[#667768] leading-relaxed">
            <i class="fa-solid fa-circle-info text-[#2c6e33] mr-1.5" aria-hidden="true"></i>
            Cấu hình này áp dụng cho <strong class="text-[#122815]">cả navbar ngang trên desktop và menu ☰ (hamburger) trên mobile</strong>. Thanh nổi cố định ở đáy màn hình điện thoại quản lý riêng tại trang
            <nuxt-link to="/admin/content/navigation/mobile" class="text-[#2c6e33] font-semibold hover:underline">Thanh nổi dưới (Mobile)</nuxt-link>.
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

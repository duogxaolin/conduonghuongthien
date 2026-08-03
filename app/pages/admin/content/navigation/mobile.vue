<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { hasPermission } = useAdminAuth()
const canEdit = computed(() => hasPermission('settings', 'update'))

type NavType = 'link' | 'chatbot' | 'drawer'
type BottomNavItem = {
  id: string
  label: string
  icon: string
  type: NavType
  url: string
  featured: boolean
}

const DEFAULT_MENU: BottomNavItem[] = [
  { id: 'home', label: 'Trang chủ', icon: 'fa-solid fa-house', type: 'link', url: '/', featured: false },
  { id: 'news', label: 'Bản tin', icon: 'fa-solid fa-newspaper', type: 'link', url: '/news', featured: false },
  { id: 'chatbot', label: 'Hỏi trợ lý', icon: 'fa-solid fa-comment-dots', type: 'chatbot', url: '', featured: true },
  { id: 'documents', label: 'Văn bản', icon: 'fa-solid fa-file-lines', type: 'link', url: '/documents', featured: false },
  { id: 'drawer', label: 'Danh mục', icon: 'fa-solid fa-bars', type: 'drawer', url: '', featured: false },
]

const TYPE_OPTIONS: { value: NavType; label: string; hint: string }[] = [
  { value: 'link', label: 'Liên kết', hint: 'Chuyển đến một trang' },
  { value: 'chatbot', label: 'Mở trợ lý AI', hint: 'Mở widget chatbot' },
  { value: 'drawer', label: 'Mở menu đầy đủ', hint: 'Mở drawer danh mục' },
]

const menu = ref<BottomNavItem[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)

function uid() { return Math.random().toString(36).slice(2, 10) }

function normalize(item: any): BottomNavItem {
  return {
    id: typeof item.id === 'string' ? item.id : uid(),
    label: item.label ?? '',
    icon: item.icon ?? 'fa-solid fa-circle',
    type: (['link', 'chatbot', 'drawer'].includes(item.type) ? item.type : 'link') as NavType,
    url: item.url ?? '',
    featured: Boolean(item.featured),
  }
}

async function loadMenu() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ ok: boolean; menu: BottomNavItem[] | null }>('/api/admin/settings/navigation/mobile')
    if (res.ok && Array.isArray(res.menu) && res.menu.length) {
      menu.value = res.menu.map(normalize)
    } else {
      menu.value = DEFAULT_MENU.map(i => ({ ...i }))
    }
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Không tải được cấu hình thanh điều hướng.'
    menu.value = DEFAULT_MENU.map(i => ({ ...i }))
  } finally {
    loading.value = false
  }
}

async function saveMenu() {
  // Enforce single featured item
  const featuredCount = menu.value.filter(i => i.featured).length
  if (featuredCount > 1) {
    toast.error('Chỉ được chọn 1 mục làm nút nổi trung tâm')
    return
  }
  saving.value = true
  try {
    await $fetch('/api/admin/settings/navigation/mobile', { method: 'PUT', body: { menu: menu.value } })
    toast.success('Đã lưu thanh điều hướng mobile thành công!')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu menu')
  } finally {
    saving.value = false
  }
}

function resetToDefault() {
  menu.value = DEFAULT_MENU.map(i => ({ ...i }))
  toast.info('Đã khôi phục mặc định — nhớ bấm Lưu để áp dụng')
}

function addItem() {
  if (menu.value.length >= 5) {
    toast.error('Thanh điều hướng tối đa 5 mục')
    return
  }
  menu.value.push({ id: uid(), label: 'Mục mới', icon: 'fa-solid fa-circle', type: 'link', url: '/', featured: false })
}
function removeItem(idx: number) { menu.value.splice(idx, 1) }
function moveItem(idx: number, dir: -1 | 1) {
  const to = idx + dir
  if (to < 0 || to >= menu.value.length) return
  const arr = [...menu.value]
  const left = arr[idx]
  const right = arr[to]
  if (left === undefined || right === undefined) return
  arr[idx] = right
  arr[to] = left
  menu.value = arr
}

// Only one item may be featured at a time
function setFeatured(idx: number, val: boolean) {
  if (val) {
    menu.value.forEach((it, i) => { it.featured = i === idx })
  } else {
    const item = menu.value[idx]
    if (item) item.featured = false
  }
}

onMounted(loadMenu)
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <nuxt-link to="/admin/content/navigation/navbar" class="text-[0.78rem] text-[#667768] hover:text-[#2c6e33] font-medium">Menu chính (Navbar + ☰)</nuxt-link>
          <span class="text-[#c8d6c9] text-xs">|</span>
          <span class="text-[0.78rem] font-bold text-[#2c6e33]">Thanh điều hướng Mobile</span>
        </div>
        <h1 class="text-[1.25rem] font-extrabold text-[#122815] m-0">Thanh điều hướng Mobile</h1>
        <p class="text-[0.82rem] text-[#667768] mt-1 m-0">Thanh nổi cố định ở đáy màn hình điện thoại — tối đa 5 mục, 1 mục có thể làm nút tròn trung tâm.</p>
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
      <span class="sr-only">Đang tải cấu hình thanh điều hướng</span>
      <div class="flex flex-col gap-3" aria-hidden="true">
        <div class="h-3 w-48 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
        <div
          v-for="n in 5"
          :key="'mb-' + n"
          class="rounded-xl border border-[#e2ece3] bg-white shadow-sm overflow-hidden"
        >
          <div class="flex items-start gap-3 px-4 py-3">
            <div class="w-6 h-11 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none shrink-0"></div>
            <div class="w-10 h-10 rounded-xl bg-[#dfe9e0] animate-pulse motion-reduce:animate-none shrink-0 mt-0.5"></div>
            <div class="flex-1 min-w-0 flex flex-col gap-2">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div class="h-8 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
                <div class="h-8 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div class="h-8 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
                <div class="h-8 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
              </div>
            </div>
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
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-[0.72rem] font-bold text-[#667768] uppercase tracking-wide">
              <i class="fa-solid fa-sliders text-[#2c6e33]" aria-hidden="true"></i>
              Cấu hình các mục ({{ menu.length }}/5)
            </div>
          </div>

          <div
            v-for="(item, idx) in menu"
            :key="item.id"
            class="rounded-xl border bg-white shadow-sm overflow-hidden"
            :class="item.featured ? 'border-[#2c6e33] ring-1 ring-[#2c6e33]/20' : 'border-[#e2ece3]'"
          >
            <div class="flex items-start gap-3 px-4 py-3">
              <!-- Reorder -->
              <div class="flex flex-col gap-0.5 shrink-0 pt-1.5">
                <button type="button" :disabled="idx === 0" class="w-6 h-5 flex items-center justify-center rounded text-[#667768] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveItem(idx, -1)" aria-label="Sang trái">
                  <i class="fa-solid fa-chevron-left text-[0.6rem]" aria-hidden="true"></i>
                </button>
                <button type="button" :disabled="idx === menu.length - 1" class="w-6 h-5 flex items-center justify-center rounded text-[#667768] hover:bg-[#e2ece3] disabled:opacity-30 focus:outline-none" @click="moveItem(idx, 1)" aria-label="Sang phải">
                  <i class="fa-solid fa-chevron-right text-[0.6rem]" aria-hidden="true"></i>
                </button>
              </div>

              <!-- Icon preview -->
              <div class="w-10 h-10 rounded-xl bg-[#f0f7f1] border border-[#e2ece3] flex items-center justify-center shrink-0 mt-0.5">
                <i :class="item.icon || 'fa-solid fa-circle'" class="text-[#2c6e33] text-base" aria-hidden="true"></i>
              </div>

              <!-- Fields -->
              <div class="flex-1 min-w-0 flex flex-col gap-2">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input v-model="item.label" type="text" placeholder="Nhãn (vd: Trang chủ)" maxlength="40" class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#122815] font-semibold focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" :disabled="!canEdit" />
                  <input v-model="item.icon" type="text" placeholder="Icon (fa-solid fa-house)" maxlength="60" class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#334e36] font-mono focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" :disabled="!canEdit" />
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select v-model="item.type" class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#334e36] font-semibold focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 bg-white" :disabled="!canEdit">
                    <option v-for="opt in TYPE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                  <input v-if="item.type === 'link'" v-model="item.url" type="text" placeholder="URL (vd: /news)" maxlength="512" class="w-full px-3 py-1.5 rounded-lg border border-[#dce8dd] text-sm text-[#334e36] font-mono focus:outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" :disabled="!canEdit" />
                  <div v-else class="flex items-center px-3 py-1.5 rounded-lg bg-[#f7fbf7] border border-dashed border-[#dce8dd] text-xs text-[#8ea98f] italic">
                    {{ TYPE_OPTIONS.find(o => o.value === item.type)?.hint }}
                  </div>
                </div>
                <label class="flex items-center gap-2 text-xs text-[#667768] cursor-pointer select-none w-fit">
                  <input type="checkbox" :checked="item.featured" :disabled="!canEdit" class="w-3.5 h-3.5 accent-[#2c6e33]" @change="setFeatured(idx, ($event.target as HTMLInputElement).checked)" />
                  <span class="font-semibold">Nút tròn nổi trung tâm</span>
                  <i class="fa-solid fa-circle-up text-[#2c6e33]" aria-hidden="true"></i>
                </label>
              </div>

              <!-- Delete -->
              <button v-if="canEdit" type="button" class="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 shrink-0 mt-0.5" @click="removeItem(idx)" aria-label="Xóa mục">
                <i class="fa-solid fa-trash text-xs" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <button v-if="canEdit && menu.length < 5" type="button" class="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#afc8b1] bg-white px-5 py-3.5 text-sm font-bold text-[#2c6e33] hover:border-[#2c6e33] hover:bg-[#f0f7f1] transition focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="addItem">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            Thêm mục ({{ menu.length }}/5)
          </button>

          <div class="rounded-lg bg-[#f7fbf7] border border-[#e2ece3] px-3.5 py-2.5 text-[0.72rem] text-[#8ea98f] flex items-start gap-2">
            <i class="fa-solid fa-lightbulb text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
            <span>Tìm tên icon tại <span class="font-mono text-[#334e36]">fontawesome.com/icons</span>. Ví dụ: <span class="font-mono">fa-solid fa-house</span>, <span class="font-mono">fa-solid fa-bars</span>.</span>
          </div>
        </div>

        <!-- ============ RIGHT: live phone bottom-nav preview ============ -->
        <div class="flex flex-col gap-3 xl:sticky xl:top-6">
          <div class="flex items-center gap-2 text-[0.72rem] font-bold text-[#667768] uppercase tracking-wide">
            <i class="fa-solid fa-eye text-[#2c6e33]" aria-hidden="true"></i>
            Xem trước website (mobile)
          </div>

          <!-- Phone frame -->
          <div class="flex justify-center rounded-xl border border-[#d7e3d8] bg-[#eef4ed] p-5">
            <div class="w-[320px] rounded-[36px] border-[6px] border-[#1f2a20] bg-[#1f2a20] p-[3px] shadow-2xl relative">
              <!-- Notch -->
              <div class="absolute top-[10px] left-1/2 -translate-x-1/2 w-20 h-3.5 bg-[#1f2a20] rounded-full z-30"></div>
              <div class="rounded-[30px] overflow-hidden bg-white relative h-[520px]">

                <!-- Fake app content underneath -->
                <div class="absolute inset-0 flex flex-col">
                  <!-- Top bar -->
                  <div class="bg-[#385130] h-6 shrink-0"></div>
                  <!-- Header -->
                  <div class="bg-white border-b border-[#E2E8DF] px-3 py-2.5 flex items-center gap-2 shrink-0">
                    <div class="w-7 h-7 rounded-full bg-[#e4f0e2] flex items-center justify-center">
                      <i class="fa-solid fa-shield-halved text-[#4A6741] text-[0.7rem]" aria-hidden="true"></i>
                    </div>
                    <div class="text-[0.68rem] font-extrabold text-[#4A6741] tracking-wide">CON ĐƯỜNG HƯỚNG THIỆN</div>
                  </div>
                  <!-- Page body -->
                  <div class="flex-1 bg-[#f8faf7] p-3 space-y-2 overflow-hidden">
                    <div class="h-24 rounded-lg bg-gradient-to-r from-[#e4f0e2] to-[#f0f6ef] flex items-center justify-center">
                      <span class="text-[0.6rem] text-[#8ea98f] italic">Nội dung trang</span>
                    </div>
                    <div class="h-3 rounded bg-[#eef4ed] w-3/4"></div>
                    <div class="h-3 rounded bg-[#eef4ed] w-1/2"></div>
                    <div class="grid grid-cols-2 gap-2 pt-1">
                      <div class="h-16 rounded-lg bg-[#eef4ed]"></div>
                      <div class="h-16 rounded-lg bg-[#eef4ed]"></div>
                    </div>
                  </div>
                </div>

                <!-- The bottom nav bar — replica of the real client component (default.vue) -->
                <nav
                  class="absolute bottom-2.5 left-3 right-3 h-16 bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(244,249,243,0.92)_100%)] backdrop-blur-[20px] border border-white/90 rounded-[24px] shadow-[0_12px_32px_rgba(15,35,18,0.16)] z-20 flex justify-around items-center px-1.5"
                  aria-label="Điều hướng nhanh (xem trước)"
                >
                  <template v-for="item in menu" :key="item.id">
                    <!-- Featured raised center button -->
                    <div
                      v-if="item.featured"
                      class="flex-1 relative flex flex-col items-center justify-center gap-0.5 text-[#385130] max-w-[52px] font-extrabold text-[0.65rem] -top-3.5"
                    >
                      <div class="w-[50px] h-[50px] rounded-full bg-gradient-to-br from-[#2e6b32] to-[#173b18] text-white flex items-center justify-center shadow-[0_10px_24px_rgba(23,59,24,0.4),inset_0_2px_4px_rgba(255,255,255,0.4)] border-[3.5px] border-white/95">
                        <i :class="item.icon || 'fa-solid fa-circle'" class="text-[1.3rem]" aria-hidden="true"></i>
                      </div>
                      <span class="mt-0.5 truncate max-w-full">{{ item.label || '—' }}</span>
                    </div>
                    <!-- Normal item (link / chatbot / drawer render identically) -->
                    <div
                      v-else
                      class="flex-1 flex flex-col items-center justify-center gap-0.5 text-[#556655] max-w-[52px] font-semibold text-[0.65rem] py-1.5"
                    >
                      <div class="flex items-center justify-center px-3 py-0.5 rounded-2xl">
                        <i :class="item.icon || 'fa-solid fa-circle'" class="text-[1.25rem]" aria-hidden="true"></i>
                      </div>
                      <span class="truncate max-w-full">{{ item.label || '—' }}</span>
                    </div>
                  </template>
                  <div v-if="!menu.length" class="text-[0.6rem] text-[#afc8b1] italic px-2">Chưa có mục nào</div>
                </nav>
              </div>
            </div>
          </div>

          <p class="text-[0.7rem] text-[#afc8b1] m-0 flex items-center gap-1.5">
            <i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i>
            Thanh nổi cố định ở đáy khi xem trên điện thoại. Preview cập nhật theo thời gian thực.
          </p>

          <!-- Info note -->
          <div class="rounded-xl border border-[#e2ece3] bg-[#f7fbf7] p-3.5 text-[0.78rem] text-[#667768] leading-relaxed">
            <i class="fa-solid fa-circle-info text-[#2c6e33] mr-1.5" aria-hidden="true"></i>
            Thanh này chỉ hiển thị trên <strong class="text-[#122815]">màn hình điện thoại</strong>. Menu ngang trên desktop quản lý riêng tại trang
            <nuxt-link to="/admin/content/navigation/navbar" class="text-[#2c6e33] font-semibold hover:underline">Menu chính (Navbar + ☰)</nuxt-link>.
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

interface SocialLink {
  id: number
  platform: string
  label: string
  url: string
  icon: string
  iconType: 'fontawesome' | 'image' | 'svg'
  color: string
  sortOrder: number
  isVisible: boolean
  createdAt: string | null
  updatedAt: string | null
}

const toast = useToast()
const { confirm } = useConfirm()
const { openPicker } = useImagePicker()

const loading = ref(true)
const loadError = ref('')
const busy = ref(false)
const items = ref<SocialLink[]>([])

const editingId = ref<number | null>(null)
const form = ref({
  platform: '',
  label: '',
  url: '',
  iconType: 'fontawesome' as 'fontawesome' | 'image' | 'svg',
  icon: 'fa-brands fa-facebook-f',
  color: '#1877f2',
  isVisible: true,
})
const formError = ref('')

// Gợi ý platform phổ biến — điền nhanh form.
const PRESETS = [
  { platform: 'Facebook', icon: 'fa-brands fa-facebook-f', color: '#1877f2' },
  { platform: 'YouTube', icon: 'fa-brands fa-youtube', color: '#ff0000' },
  { platform: 'Zalo', icon: 'fa-solid fa-message', color: '#0068ff' },
  { platform: 'TikTok', icon: 'fa-brands fa-tiktok', color: '#000000' },
  { platform: 'X (Twitter)', icon: 'fa-brands fa-x-twitter', color: '#000000' },
  { platform: 'Instagram', icon: 'fa-brands fa-instagram', color: '#e4405f' },
  { platform: 'LinkedIn', icon: 'fa-brands fa-linkedin-in', color: '#0a66c2' },
  { platform: 'Telegram', icon: 'fa-brands fa-telegram', color: '#0088cc' },
]

function applyPreset(p: { platform: string; icon: string; color: string }) {
  form.value.platform = p.platform
  form.value.iconType = 'fontawesome'
  form.value.icon = p.icon
  form.value.color = p.color
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: SocialLink[] }>)('/api/admin/social-links')
    if (res.ok) items.value = res.items || []
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không tải được danh sách mạng xã hội.')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  editingId.value = null
  form.value = { platform: '', label: '', url: '', iconType: 'fontawesome', icon: 'fa-brands fa-facebook-f', color: '#1877f2', isVisible: true }
  formError.value = ''
}

function startEdit(item: SocialLink) {
  editingId.value = item.id
  form.value = {
    platform: item.platform,
    label: item.label,
    url: item.url,
    iconType: (item.iconType || 'fontawesome') as 'fontawesome' | 'image' | 'svg',
    icon: item.icon,
    color: item.color,
    isVisible: item.isVisible,
  }
  formError.value = ''
  nextTick(() => document.getElementById('social-form-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

// Chọn ảnh/SVG từ thư viện media.
function pickMediaIcon() {
  openPicker({
    onSelect: (img) => {
      // `mimeType` quyết định loại: image/svg+xml → 'svg', còn lại → 'image'.
      const isSvg = (img.mimeType || '').includes('svg')
      form.value.iconType = isSvg ? 'svg' : 'image'
      form.value.icon = img.url
    },
  })
}

async function save() {
  formError.value = ''
  if (!form.value.platform.trim()) { formError.value = 'Nền tảng bắt buộc.'; return }
  if (!form.value.label.trim()) { formError.value = 'Nhãn hiển thị bắt buộc.'; return }
  if (!form.value.url.trim()) { formError.value = 'Đường dẫn bắt buộc.'; return }
  if (!form.value.icon.trim()) { formError.value = 'Icon bắt buộc (class FontAwesome hoặc chọn ảnh/SVG).' ; return }
  if (form.value.iconType === 'fontawesome' && !/^fa-/.test(form.value.icon.trim())) {
    formError.value = 'Icon FontAwesome phải bắt đầu bằng fa- (vd fa-brands fa-facebook-f).'
    return
  }
  if ((form.value.iconType === 'image' || form.value.iconType === 'svg')
      && !/^(https?:\/\/|\/uploads\/|\/assets\/)/i.test(form.value.icon.trim())) {
    formError.value = 'Đường dẫn ảnh/SVG phải là http(s)://, /uploads/ hoặc /assets/.'
    return
  }
  busy.value = true
  try {
    if (editingId.value == null) {
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; id: number }>)('/api/admin/social-links', {
        method: 'POST', body: { ...form.value, sortOrder: items.value.length },
      })
      toast.success(`Đã thêm "${form.value.label}".`)
      editingId.value = res.id
    } else {
      await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean }>)(`/api/admin/social-links/${editingId.value}`, {
        method: 'PUT', body: form.value,
      })
      toast.success(`Đã cập nhật "${form.value.label}".`)
    }
    await load()
  } catch (err: unknown) {
    formError.value = errorMessage(err, 'Lưu thất bại.')
  } finally {
    busy.value = false
  }
}

async function toggleVisible(item: SocialLink) {
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean }>)(`/api/admin/social-links/${item.id}`, {
      method: 'PUT', body: { isVisible: !item.isVisible },
    })
    item.isVisible = !item.isVisible
    toast.success(item.isVisible ? `Đã hiện "${item.label}".` : `Đã ẩn "${item.label}".`)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không đổi được trạng thái.'))
  }
}

async function remove(item: SocialLink) {
  const ok = await confirm({
    title: 'Xóa mạng xã hội',
    message: `Xóa "${item.label}" khỏi danh sách? Thao tác không thể hoàn tác.`,
    danger: true,
    confirmLabel: 'Xóa',
  })
  if (!ok) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/social-links/${item.id}`, { method: 'DELETE' })
    toast.success(`Đã xóa "${item.label}".`)
    if (editingId.value === item.id) resetForm()
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Xóa thất bại.'))
  }
}

async function move(item: SocialLink, dir: -1 | 1) {
  const idx = items.value.findIndex((i) => i.id === item.id)
  const swap = idx + dir
  if (swap < 0 || swap >= items.value.length) return
  const ordered = items.value.map((i) => i.id)
  ;[ordered[idx], ordered[swap]] = [ordered[swap] as number, ordered[idx] as number]
  // Đảo local ngay để UI responsive, rồi sync server.
  ;[items.value[idx], items.value[swap]] = [items.value[swap] as SocialLink, items.value[idx] as SocialLink]
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean }>)('/api/admin/social-links/reorder', {
      method: 'POST', body: { orderedIds: ordered },
    })
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không cập nhật thứ tự được.'))
    await load()
  }
}

onMounted(() => { load() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Mạng xã hội</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Quản lý popup MXH nổi ở góc trái trang công khai (đối xứng chatbot góc phải).</p>
    </div>

    <!-- Form thêm/sửa -->
    <div id="social-form-top" class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="m-0 text-sm font-extrabold text-[#122815]">{{ editingId == null ? 'Thêm mạng xã hội' : 'Sửa mạng xã hội' }}</h2>
        <button v-if="editingId != null" type="button" class="text-xs font-semibold text-[#667768] hover:text-[#d12420]" @click="resetForm">Hủy sửa</button>
      </div>

      <!-- Presets -->
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="p in PRESETS"
          :key="p.platform"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-[#e2ece3] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#3d4f3f] hover:bg-[#f0f7f1] transition-colors"
          @click="applyPreset(p)"
        >
          <i :class="p.icon" :style="{ color: p.color }" aria-hidden="true"></i>
          <span>{{ p.platform }}</span>
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-bold text-[#3d4f3f]">Nền tảng <span class="text-[#d12420]">*</span></span>
          <input v-model="form.platform" type="text" placeholder="Facebook, YouTube..." class="px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-bold text-[#3d4f3f]">Nhãn hiển thị <span class="text-[#d12420]">*</span></span>
          <input v-model="form.label" type="text" placeholder="Fanpage C11..." class="px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
        </label>
        <label class="flex flex-col gap-1 sm:col-span-2">
          <span class="text-xs font-bold text-[#3d4f3f]">Đường dẫn <span class="text-[#d12420]">*</span></span>
          <input v-model="form.url" type="text" placeholder="https://facebook.com/..." class="px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
        </label>
        <!-- Icon: 3 chế độ (FontAwesome / Ảnh / SVG) -->
        <div class="flex flex-col gap-1.5 sm:col-span-2">
          <span class="text-xs font-bold text-[#3d4f3f]">Icon</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="opt in [{ k: 'fontawesome', l: 'FontAwesome', i: 'fa-solid fa-font' }, { k: 'image', l: 'Ảnh (PNG/JPG/WebP)', i: 'fa-regular fa-image' }, { k: 'svg', l: 'SVG', i: 'fa-regular fa-file-code' }]"
              :key="opt.k"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
              :class="form.iconType === opt.k ? 'border-[#2c6e33] bg-[#2c6e33] text-white' : 'border-[#c8d6c9] bg-white text-[#3d4f3f] hover:bg-[#f0f7f1]'"
              @click="form.iconType = opt.k as 'fontawesome' | 'image' | 'svg'; if (opt.k === 'fontawesome' && !form.icon.startsWith('fa-')) form.icon = 'fa-brands fa-facebook-f'"
            >
              <i :class="opt.i" aria-hidden="true"></i>{{ opt.l }}
            </button>
          </div>

          <div v-if="form.iconType === 'fontawesome'" class="flex flex-col gap-1.5">
            <input v-model="form.icon" type="text" placeholder="fa-brands fa-facebook-f" class="px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
            <p class="m-0 text-[0.72rem] text-[#667768]">Nhập class Font Awesome (fa-solid / fa-brands / fa-regular). Vd: <code class="bg-[#f0f7f1] px-1 rounded">fa-brands fa-youtube</code></p>
          </div>

          <div v-else class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <input
                :value="form.icon"
                @input="form.icon = ($event.target as HTMLInputElement).value"
                type="text"
                :placeholder="form.iconType === 'svg' ? '/uploads/2026/09/logo.svg hoặc URL' : '/uploads/2026/09/logo.png hoặc URL'"
                class="flex-1 px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
              />
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-xs font-bold text-[#2c6e33] hover:bg-[#f0f7f1] transition-colors whitespace-nowrap"
                @click="pickMediaIcon"
              >
                <i class="fa-regular fa-folder-open" aria-hidden="true"></i> Chọn từ thư viện
              </button>
            </div>
            <p class="m-0 text-[0.72rem] text-[#667768]">
              {{ form.iconType === 'svg'
                ? 'SVG vector — sắc nét mọi kích thước. Tải file .svg lên thư viện media rồi chọn.'
                : 'Ảnh raster (PNG/JPG/WebP) — phù hợp logo có chi tiết.' }}
            </p>
          </div>

          <!-- Preview icon thật trong ô màu brand, đúng như hiển thị ngoài cổng. -->
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[0.72rem] text-[#667768]">Xem trước:</span>
            <span
              class="flex h-9 w-9 items-center justify-center rounded-lg overflow-hidden border border-[#e2ece3]"
              :style="form.iconType === 'fontawesome' ? { backgroundColor: form.color, color: '#fff' } : {}"
            >
              <img v-if="form.iconType === 'image'" :src="form.icon" :alt="'preview'" class="h-8 w-8 object-contain" />
              <img v-else-if="form.iconType === 'svg'" :src="form.icon" :alt="'preview'" class="h-9 w-9 object-cover" />
              <i v-else :class="form.icon" class="text-base" aria-hidden="true"></i>
            </span>
            <span class="text-[0.72rem] text-[#667768]">{{ form.platform || 'Nền tảng' }} · {{ form.label || 'Nhãn' }}</span>
          </div>
        </div>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-bold text-[#3d4f3f]">Màu nền hex</span>
          <div class="flex items-center gap-2">
            <input v-model="form.color" type="color" class="h-9 w-9 rounded-lg border border-[#c8d6c9] cursor-pointer p-0.5" />
            <input v-model="form.color" type="text" class="flex-1 px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
          </div>
          <span v-if="form.iconType !== 'fontawesome'" class="text-[0.68rem] text-[#667768]">Dùng cho nền ô icon (ảnh/SVG trong suốt sẽ hiện màu này).</span>
        </label>
        <label class="flex items-center gap-2 sm:col-span-2">
          <input v-model="form.isVisible" type="checkbox" class="h-4 w-4 accent-[#2c6e33]" />
          <span class="text-sm font-semibold text-[#3d4f3f]">Hiển thị trên trang công khai</span>
        </label>
      </div>

      <div v-if="formError" role="alert" class="text-xs text-[#b04a4a] flex items-center gap-1.5">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>{{ formError }}
      </div>

      <div class="flex gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-2 bg-[#2c6e33] hover:bg-[#1e4620] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          :disabled="busy"
          @click="save"
        >
          <i class="fa-solid fa-floppy-disk text-xs" aria-hidden="true"></i>
          {{ editingId == null ? 'Thêm' : 'Lưu thay đổi' }}
        </button>
        <button
          v-if="editingId == null"
          type="button"
          class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] text-[#3d4f3f] font-bold px-4 py-2.5 rounded-lg cursor-pointer hover:bg-[#f0f7f1] transition-colors text-sm"
          @click="resetForm"
        >Xóa form</button>
      </div>
    </div>

    <!-- List -->
    <SkeletonTable v-if="loading" label="Đang tải danh sách mạng xã hội" :rows="4" :cols="5" />

    <div v-else-if="loadError" role="alert" class="flex flex-col items-center gap-3 py-12 text-[#b04a4a]">
      <i class="fa-solid fa-triangle-exclamation text-3xl text-[#e2a0a0]" aria-hidden="true"></i>
      <p class="m-0 text-sm">{{ loadError }}</p>
      <button type="button" class="inline-flex items-center gap-2 bg-[#2c6e33] hover:bg-[#1e4620] text-white font-bold px-4 py-2 rounded-lg cursor-pointer border-0 text-sm" @click="load">
        <i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Thử lại
      </button>
    </div>

    <div v-else-if="items.length === 0" class="flex flex-col items-center gap-3 py-12 text-[#9ca3af]">
      <i class="fa-solid fa-share-nodes text-4xl text-[#d1d5db]" aria-hidden="true"></i>
      <p class="m-0 text-sm">Chưa có mạng xã hội nào. Thêm cái đầu tiên ở phía trên.</p>
    </div>

    <!-- Danh sách dạng thẻ ngang — icon to, tên nổi, URL rút gọn, thao tác gọn một hàng -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <div
        v-for="(item, idx) in items"
        :key="item.id"
        class="group bg-white rounded-xl border border-[#e2ece3] p-3.5 flex flex-col gap-3 transition-shadow hover:shadow-[0_4px_16px_rgba(15,35,18,0.08)]"
        :class="{ 'opacity-60': !item.isVisible }"
      >
        <!-- Hàng 1: icon + tên + số thứ tự -->
        <div class="flex items-start gap-3">
          <span
            class="flex h-11 w-11 items-center justify-center rounded-xl shrink-0 overflow-hidden"
            :style="item.iconType === 'fontawesome' ? { backgroundColor: item.color, color: '#fff' } : {}"
          >
            <img v-if="item.iconType === 'image'" :src="item.icon" :alt="item.label" class="h-9 w-9 object-contain" />
            <img v-else-if="item.iconType === 'svg'" :src="item.icon" :alt="item.label" class="h-11 w-11 object-cover" />
            <i v-else :class="item.icon" class="text-lg" aria-hidden="true"></i>
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[0.95rem] font-extrabold text-[#122815] truncate">{{ item.platform }}</span>
              <span class="text-[0.62rem] font-bold text-[#9ca3af] bg-[#f4f7f4] rounded px-1.5 py-0.5 shrink-0">#{{ idx + 1 }}</span>
            </div>
            <p class="m-0 text-[0.78rem] text-[#4A5545] truncate">{{ item.label }}</p>
          </div>
        </div>

        <!-- Hàng 2: URL -->
        <a
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1.5 text-[0.72rem] text-[#2c6e33] hover:underline truncate"
          :title="item.url"
        >
          <i class="fa-solid fa-arrow-up-right-from-square text-[0.6rem] shrink-0" aria-hidden="true"></i>
          <span class="truncate">{{ item.url.replace(/^https?:\/\//, '') }}</span>
        </a>

        <!-- Hàng 3: thao tác -->
        <div class="flex items-center gap-1 pt-1 border-t border-[#eef2ee]">
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#667768] hover:bg-[#f0f7f1] hover:text-[#2c6e33] disabled:opacity-25 disabled:hover:bg-transparent" :disabled="idx === 0" :aria-label="`Di chuyển ${item.label} lên`" @click="move(item, -1)"><i class="fa-solid fa-arrow-up text-[0.7rem]" aria-hidden="true"></i></button>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#667768] hover:bg-[#f0f7f1] hover:text-[#2c6e33] disabled:opacity-25 disabled:hover:bg-transparent" :disabled="idx === items.length - 1" :aria-label="`Di chuyển ${item.label} xuống`" @click="move(item, 1)"><i class="fa-solid fa-arrow-down text-[0.7rem]" aria-hidden="true"></i></button>
          <button
            type="button"
            class="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            :class="item.isVisible ? 'text-[#1e4620] hover:bg-[#f0f7f1]' : 'text-[#9ca3af] hover:bg-[#f4f7f4]'"
            :aria-label="item.isVisible ? 'Ẩn khỏi trang công khai' : 'Hiện trên trang công khai'"
            @click="toggleVisible(item)"
          >
            <i :class="item.isVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'" class="text-[0.72rem]" aria-hidden="true"></i>
          </button>
          <div class="flex-1"></div>
          <button type="button" class="inline-flex items-center gap-1 text-[0.72rem] font-bold text-[#2c6e33] hover:bg-[#f0f7f1] px-2 py-1 rounded-lg" @click="startEdit(item)">
            <i class="fa-solid fa-pen text-[0.65rem]" aria-hidden="true"></i> Sửa
          </button>
          <button type="button" class="inline-flex items-center gap-1 text-[0.72rem] font-bold text-[#d12420] hover:bg-[#fdecec] px-2 py-1 rounded-lg" @click="remove(item)">
            <i class="fa-solid fa-trash text-[0.65rem]" aria-hidden="true"></i> Xóa
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

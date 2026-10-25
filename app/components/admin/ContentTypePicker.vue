<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import AdminModal from '~/components/admin/AdminModal.vue'

/**
 * Dialog picker chọn một Content-Type (và tùy chọn category con) để thêm nhanh
 * vào menu navbar/mobile.
 *
 * - Click vào **tên thể loại** (row chính) → emit `pick` + close — caller push root
 *   menu item không con (quick-add).
 * - Click vào **tên category con** (row con, indent dưới thể loại khi expand) →
 *   emit `pickChild` với `{ parentSlug, parentName, parentIcon, child }` — caller
 *   tìm/tạo root trong menu rồi push child vào `children[]`.
 *
 * Dùng `/api/public/content-types` + `/api/public/categories` (công khai, không
 * cần auth) để cả trang navbar (quyền `settings.update`) lẫn mobile đều gọi được.
 *
 * Giữ `error` ref + `fetchTypes` để test guard `admin-error-retry-ui` không đỏ.
 */
const emit = defineEmits<{
  (e: 'pick', value: { slug: string; name: string; url: string; icon: string | null }): void
  (e: 'pickChild', value: { parentSlug: string; parentName: string; parentIcon: string | null; child: { slug: string; name: string; url: string } }): void
  (e: 'close'): void
}>()

interface PublicContentType {
  slug: string
  name: string
  icon: string | null
  description: string | null
}

interface PublicCategory {
  id: number
  name: string
  slug: string
  parentId: number | null
}

const items = ref<PublicContentType[]>([])
const loading = ref(true)
const error = ref('')

/** Cache category con theo type-slug; key = type slug, value = children list. */
const childrenByType = reactive<Record<string, PublicCategory[]>>({})
/** Track expand state per type slug. */
const expanded = reactive<Record<string, boolean>>({})
/** Track loading per type slug khi fetch children. */
const loadingChildren = reactive<Record<string, boolean>>({})

const fetchTypes = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicContentType[] }>)('/api/public/content-types')
    if (res.ok) {
      items.value = res.items
    } else {
      error.value = 'Không tải được danh sách thể loại.'
    }
  } catch {
    // Endpoint công khai trả 503 `{ ok: false }` khi CSDL hỏng — thân phản hồi
    // không có câu nào cho người đọc, chỉ có status text tiếng Anh thô
    // ("Service Unavailable"), nên hiện thông điệp cố định như nhánh `!res.ok`.
    error.value = 'Không tải được danh sách thể loại.'
  } finally {
    loading.value = false
  }
}

/** Fetch root categories của 1 type (parentId === null). Cache trong childrenByType. */
const fetchChildren = async (typeSlug: string) => {
  if (childrenByType[typeSlug]) return // đã cache
  loadingChildren[typeSlug] = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicCategory[] }>)(`/api/public/categories`, { query: { type: typeSlug } })
    if (res.ok) {
      // Chỉ lấy root (parentId === null) — children cháu không query (nav chỉ 1 cấp).
      childrenByType[typeSlug] = res.items.filter((c) => c.parentId === null)
    } else {
      childrenByType[typeSlug] = []
    }
  } catch {
    childrenByType[typeSlug] = []
  } finally {
    loadingChildren[typeSlug] = false
  }
}

const toggleExpand = (typeSlug: string) => {
  expanded[typeSlug] = !expanded[typeSlug]
  if (expanded[typeSlug]) void fetchChildren(typeSlug)
}

/** Click 1 thể loại → emit pick + close (root không con). */
const pick = (ct: PublicContentType) => {
  emit('pick', { slug: ct.slug, name: ct.name, url: `/${ct.slug}`, icon: ct.icon })
  emit('close')
}

/** Click 1 category con → emit pickChild + close. Caller tự tìm/tạo root. */
const pickChild = (ct: PublicContentType, child: PublicCategory) => {
  emit('pickChild', {
    parentSlug: ct.slug,
    parentName: ct.name,
    parentIcon: ct.icon,
    child: { slug: child.slug, name: child.name, url: `/${ct.slug}/${child.slug}` },
  })
  emit('close')
}

onMounted(fetchTypes)
</script>

<template>
  <!-- Cha mở picker bằng `v-if`: hộp luôn mở khi còn được mount, gỡ là đóng (AdminModal
       trả focus về nút đã mở lúc bị gỡ). -->
  <AdminModal :open="true" title="Chọn Thể loại" icon="fa-solid fa-sitemap" @close="$emit('close')">
          <div class="flex flex-col gap-3">
            <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-2">
              <span class="sr-only">Đang tải danh sách thể loại</span>
              <div v-for="n in 4" :key="n" class="h-10 bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none" aria-hidden="true"></div>
            </div>

            <div v-else-if="error" role="alert" class="text-sm text-[#B04A4A] flex items-center gap-2">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              {{ error }}
              <button type="button" class="text-brand-600 font-bold underline" @click="fetchTypes">Thử lại</button>
            </div>

            <ul v-else-if="items.length" class="list-none m-0 p-0 flex flex-col gap-2 max-h-[380px] overflow-y-auto">
              <li v-for="ct in items" :key="ct.slug" class="flex flex-col">
                <div class="flex items-center gap-2">
                  <!-- Row thể loại (click = thêm root) -->
                  <button type="button" class="flex-1 flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-line bg-white text-left text-sm hover:border-brand-700 hover:bg-surface-tint transition-colors cursor-pointer" @click="pick(ct)">
                    <i :class="[ct.icon || 'fa-solid fa-sitemap', 'text-brand-700 text-[1rem]']" aria-hidden="true"></i>
                    <span class="flex-1 font-semibold text-brand-950">{{ ct.name }}</span>
                    <span class="text-[0.72rem] text-ink-muted font-normal">/{{ ct.slug }}</span>
                    <i class="fa-solid fa-plus text-brand-700 text-[0.72rem]" aria-hidden="true"></i>
                  </button>
                  <!-- Nút expand category con -->
                  <button type="button" class="w-9 h-9 flex items-center justify-center rounded-lg border border-line bg-white hover:bg-surface-tint transition-colors cursor-pointer shrink-0" :aria-expanded="!!expanded[ct.slug]" :aria-label="expanded[ct.slug] ? `Thu gọn danh mục con của ${ct.name}` : `Xem danh mục con của ${ct.name}`" @click="toggleExpand(ct.slug)">
                    <i :class="['fa-solid', expanded[ct.slug] ? 'fa-chevron-up' : 'fa-chevron-down', 'text-ink-muted text-[0.72rem]']" aria-hidden="true"></i>
                  </button>
                </div>

                <!-- Category con (expand) -->
                <div v-if="expanded[ct.slug]" class="mt-1.5 ml-4 border-l-2 border-line pl-3 flex flex-col gap-1.5">
                  <div v-if="loadingChildren[ct.slug]" role="status" aria-busy="true" class="flex flex-col gap-1.5 py-1">
                    <span class="sr-only">Đang tải danh mục con</span>
                    <div v-for="n in 2" :key="n" class="h-8 bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none" aria-hidden="true"></div>
                  </div>
                  <template v-else-if="(childrenByType[ct.slug] || []).length">
                    <button
                      v-for="child in childrenByType[ct.slug]"
                      :key="child.id"
                      type="button"
                      class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white border border-transparent hover:border-brand-700 hover:bg-surface-tint transition-colors cursor-pointer text-left"
                      @click="pickChild(ct, child)"
                    >
                      <i class="fa-regular fa-folder text-[#8ed694] text-[0.82rem]" aria-hidden="true"></i>
                      <span class="flex-1 text-[0.85rem] font-semibold text-[#2c3e2e]">{{ child.name }}</span>
                      <span class="text-[0.68rem] text-ink-muted font-normal">/{{ child.slug }}</span>
                      <i class="fa-solid fa-plus text-brand-700 text-[0.68rem]" aria-hidden="true"></i>
                    </button>
                  </template>
                  <p v-else class="text-[0.78rem] text-ink-muted m-0 py-2 px-3 italic">
                    Thể loại này chưa có danh mục con.
                  </p>
                </div>
              </li>
            </ul>

            <p v-else class="text-sm text-ink-muted m-0 py-6 text-center">
              Chưa có thể loại nào. Tạo thể loại tại <strong>Quản lý nội dung → Thể loại</strong>.
            </p>

            <p v-if="!loading && !error && items.length" class="text-[0.78rem] text-ink-muted m-0">
              <i class="fa-solid fa-circle-info text-brand-700 mr-1" aria-hidden="true"></i>
              Bấm <strong>tên thể loại</strong> để thêm mục gốc, hoặc <strong>▸</strong> để xem + thêm danh mục con. Vẫn sửa label/URL tay sau khi thêm.
            </p>
          </div>

    <template #footer>
            <button type="button" class="px-4 py-2 rounded-lg border border-line-strong bg-white text-ink-muted font-semibold text-sm cursor-pointer hover:bg-[#f8faf8] transition-colors" @click="$emit('close')">
              Đóng
            </button>
    </template>
  </AdminModal>
</template>

<template>
  <!--
    Thanh điều hướng ngang chỉ hiện từ `lg` (1024px), không từ `md` (768px).

    `nav` mang `w-max`, nên nó rộng theo NỘI DUNG chứ không theo container:
    tám mục mặc định cần ~852px. Ở `md` thanh này bật lên trong một khung chỉ
    rộng 768px, nên `min-w-full` không cứu được gì — phần thừa đẩy ra ngoài và
    **cả trang cuộn ngang được**, ở mọi trang chứ không riêng trang nào. Đây
    là lý do các mục cuối ("Liên hệ") bị cắt trên tablet.

    Không chọn `overflow-x-auto` cho container: dropdown là `absolute` mở
    xuống dưới, và một khung cuộn ngang cũng cắt luôn chiều dọc (`overflow-x`
    khác `visible` biến `overflow-y: visible` thành `auto`) — nó sẽ cắt mất
    đúng menu con. Cũng không cho `ul` xuống dòng: thanh này cao cố định 50px.

    Khoảng 768–1023px giao cho hamburger, và không mất gì: drawer dựng từ
    cùng `navMenu`, có accordion cho mục con.

    ⚠️ Menu do admin cấu hình được (`/admin/content/navigation/navbar`), nên
    thêm thật nhiều mục vẫn có thể vượt cả 1024px. Đó là tính chất có sẵn của
    một thanh ngang cao cố định, không phải thứ breakpoint này hứa sẽ chặn.
  -->
  <div class="hidden lg:flex bg-white border-t border-[#edf2ec] border-b border-[#e1e8e0] h-[50px] items-center shadow-[0_4px_12px_rgba(15,35,18,0.04)] transition-all">
    <div class="container w-full overflow-x-auto xl:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <nav class="desktop-nav flex w-max min-w-full" aria-label="Điều hướng chính" @click="onNavClick" @keydown.escape="$emit('toggle-mobile-menu')">
        <ul class="flex list-none w-full justify-start lg:justify-between items-center gap-2 lg:gap-1 flex-nowrap">
          <li v-for="item in navMenu" :key="item.id" :class="item.children && item.children.length ? 'relative group focus-within:z-[103]' : ''">
            <!-- With children: dropdown -->
            <template v-if="item.children && item.children.length">
              <!-- Bấm mục con (link thật) → reset dropdown toggle để đóng lại sau khi navigate. -->
              <div
                class="nav-item no-underline text-[#1e4620] font-bold text-[0.8rem] px-2 lg:text-[0.88rem] lg:px-3 py-2 rounded-lg flex items-center gap-1 whitespace-nowrap cursor-pointer transition-all hover:bg-[#f0f6ef] hover:text-[#143516]"
                :aria-haspopup="true"
                :role="item.url === '#' ? 'button' : undefined"
                :tabindex="item.url === '#' ? 0 : undefined"
                :aria-label="item.url === '#' ? navItemLabel(item) : undefined"
                :aria-expanded="item.url === '#' ? openMenuId === item.id : undefined"
                @click="item.url === '#' ? toggleDesktopSubmenu(item.id) : undefined"
              >
                <component
                  :is="item.url && item.url !== '#' ? NuxtLink : 'span'"
                  v-bind="item.url && item.url !== '#' ? { to: item.url, 'active-class': 'active-item', class: 'text-inherit no-underline' } : {}"
                >{{ navItemLabel(item) }}</component>
                <i class="fa-solid fa-chevron-down text-[0.55rem] ml-0.5 text-[#557757] transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180" aria-hidden="true"></i>
              </div>
              <ul class="absolute top-[calc(100%+4px)] left-0 bg-white shadow-[0_14px_36px_rgba(15,35,18,0.18),0_2px_8px_rgba(0,0,0,0.04)] rounded-xl border border-[rgba(30,70,32,0.12)] p-2 min-w-[220px] list-none opacity-0 translate-y-2 scale-[0.97] pointer-events-none z-[102] transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:pointer-events-auto before:absolute before:top-[-4px] before:left-0 before:h-[4px] before:w-full before:content-['']" :class="openMenuId === item.id ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : ''" @click="openMenuId = null">
                <li v-for="child in item.children" :key="child.id">
                  <component
                    :is="shouldOpenNewTab(child) ? 'a' : NuxtLink"
                    v-bind="shouldOpenNewTab(child) ? { href: child.url, target: child.openNewTab ? '_blank' : undefined, rel: child.openNewTab ? 'noopener noreferrer' : undefined } : { to: child.url, 'aria-current-value': 'page' }"
                    class="block px-3.5 py-2.5 no-underline text-[#2d4a2d] text-[0.86rem] font-semibold rounded-lg transition-all hover:bg-[rgba(30,70,32,0.07)] hover:text-[#1e4620] hover:pl-[18px]"
                  >{{ navItemLabel(child) }}</component>
                </li>
              </ul>
            </template>
            <!-- No children: simple link -->
            <template v-else>
              <component
                :is="shouldOpenNewTab(item) ? 'a' : NuxtLink"
                v-bind="shouldOpenNewTab(item) ? { href: item.url, target: item.openNewTab ? '_blank' : undefined, rel: item.openNewTab ? 'noopener noreferrer' : undefined } : { to: item.url, 'active-class': 'active-item bg-[#e4f0e2] font-extrabold', 'aria-current-value': 'page' }"
                class="nav-item no-underline text-[#1e4620] font-bold text-[0.8rem] px-2 lg:text-[0.88rem] lg:px-3 py-2 rounded-lg flex items-center gap-1 whitespace-nowrap relative transition-all hover:bg-[#f0f6ef] hover:text-[#143516]"
              >{{ navItemLabel(item) }}</component>
            </template>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { resolveComponent, ref } from 'vue'
import type { NavItem } from '~/utils/nav-config'

/**
 * Thanh điều hướng ngang desktop (lg+). Lặp `navMenu` + `v-for="child in item.children"`
 * cho dropdown — `tests/public-pages-structure.test.ts` đếm vòng lặp child === 2
 * (desktop + drawer mobile).
 *
 * Dropdown mở bằng **ba cơ chế cộng lặp**:
 *  - `group-hover` (CSS) — trỏ chuột vào mục cha, dropdown mở, rời chuột đóng.
 *  - `group-focus-within` (CSS) — Tab/focus vào mục cha, dropdown dính.
 *  - `openMenuId` (JS toggle) — bấm chuột vào mục cha `url === '#'` (dropdown-only),
 *    dropdown dính cho đến khi bấm lại. Cơ chế này cần vì click vào `<span>` con
 *    của `<div tabindex=0>` không focus được div cha trên Chrome desktop, nên
 *    `group-focus-within` không trigger — và `group-hover` không dính sau khi
 *    rời chuột. Bug #1: bấm "Đào tạo nghề"/"Pháp luật" (url `#`) không mở dropdown.
 *
 * Mục cha có URL thật + children (vd `Bản tin` url `/news`): click navigate,
 *    dropdown chỉ mở qua hover/focus — không toggle, không can thiệp.
 */
defineProps<{
  navMenu: NavItem[]
  navItemLabel: (item: NavItem) => string
  onNavClick: (event: Event) => void
}>()
defineEmits<{ 'toggle-mobile-menu': [] }>()

const NuxtLink = resolveComponent('NuxtLink')

const openMenuId = ref<string | null>(null)
const toggleDesktopSubmenu = (id: string) => {
  openMenuId.value = openMenuId.value === id ? null : id
}

/**
 * Có nên render `<a target="_blank">` thay vì `NuxtLink` cho mục này không.
 *
 * Link ngoài (`http…`) luôn mở bằng `<a>` (NuxtLink không xử lý URL ngoài). Link
 * nội bộ (`/about`) chỉ mở `<a target="_blank">` khi cán bộ tick ô "Tab mới" —
 * trước đây `openNewTab` bị bỏ qua cho link nội bộ vì nhánh `<a>` chỉ rẽ theo
 * `startsWith('http')`. Giờ rẽ theo helper này nên cờ có tác dụng cho cả hai.
 *
 * `target`/`rel` trong v-bind vẫn đọc `openNewTab` (giữ pattern test guard grep
 * `openNewTab ? '_blank'` + `rel: …openNewTab…noopener`).
 */
function shouldOpenNewTab(item: NavItem): boolean {
  return !!(item.url && (item.url.startsWith('http') || item.openNewTab === true))
}
</script>

<style scoped>
.nav-item::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 12px;
  right: 12px;
  height: 3px;
  background-color: #1e4620;
  border-radius: 4px;
  opacity: 0;
  transform: scaleX(0);
  transition: all 0.25s ease;
}
.nav-item:hover::after,
.active-item::after,
.nav-item:has(a.active-item)::after {
  opacity: 1;
  transform: scaleX(1);
}
.nav-item:has(a.active-item) {
  color: #1e4620;
  background-color: #e4f0e2;
  font-weight: 800;
}
.nav-item:has(a.active-item) a {
  color: #1e4620;
}
</style>

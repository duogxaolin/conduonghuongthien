import { computed, type Ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import {
  DEFAULT_BOTTOM_NAV,
  DEFAULT_NAV,
  parseBottomNavConfig,
  parseNavConfig,
} from '~/utils/nav-config'
import type { BottomNavItem, NavItem } from '~/utils/nav-config'

/**
 * Cấu hình điều hướng động từ admin settings (fallback DEFAULT_NAV /
 * DEFAULT_BOTTOM_NAV). State ở đây chứ không trong default.vue để template
 * default.vue vẫn bind `navMenu`/`bottomNav`/`navItemLabel(item)` bình thường —
 * template chỉ cần tên biến cục bộ, không cần biết source.
 *
 * `navMenu`/`bottomNav` là **computed đọc trực tiếp từ `settingsData`** — không
 * qua `ref` trung gian + `watch` như trước. Lý do: trong SSR, `useAsyncData`
 * resolve **sau** khi `watch(settingsData, { immediate: true })` chạy đồng bộ
 * trong setup (lúc đó `settingsData.value` vẫn `null`), nên `navMenuRaw` không
 * được set kịp → SSR dựng `DEFAULT_NAV`. Client hydrate dùng payload `useAsyncData`
 * (đã resolve) → dựng DB config → **hydration mismatch**. Vue khớp vnode `v-for`
 * theo `:key`, và vì key SSR (`legal-qa` ở index 7) ≠ key client (`contact` ở index
 * 7), nó giữ lại `class="group"` của `<li>` SSR trên **sai** `<li>` sau hydrate —
 * dropdown `group-hover` của "Đào tạo nghề"/"Pháp luật" không bao giờ trigger.
 *
 * Computed đọc `settingsData` re-evaluate khi SSR render (sau khi `useAsyncData`
 * resolve) → SSR dựng đúng DB config → không mismatch → `group` class đúng chỗ.
 *
 * `setNavMenu`/`setBottomNav` vẫn giữ cho `default.vue` `watch(settingsData)`
 * cũ (chạy layout config + fallback) — nhưng `navMenu`/`bottomNav` computed
 * không phụ thuộc chúng nữa.
 *
 * `navItemLabel` đọc i18n khi `currentLang !== 'vi'`: trước thử `labelKey`, sau
 * thử `NAV_LABEL_TO_KEY` ánh xạ label Việt → key i18n.
 *
 * `useI18n()` gọi ở scope setup của composable (một lần), không trong thân
 * `navItemLabel`: composition API nên gọi lúc setup, không mỗi lần template
 * invoke hàm — dù `useI18n` dùng `useState` (gọi được mọi đâu), giữ ở scope
 * setup là pattern đúng và rẻ hơn (không tạo lại cookie/watcher mỗi render).
 */
export function useLayoutNav(settingsData?: Ref<{ settings?: Record<string, string | null> } | null>) {
  const { currentLang, t } = useI18n()
  // `NavItem[] | null` tường minh: `null` nghĩa là "chưa có cấu hình, dùng bảng mặc
  // định". Đây cũng là chỗ `openNewTab` được đọc, nên khai đúng kiểu ở đây là điều
  // biến cổng typecheck thành thứ **bắt được** một trường nav bị bộ khử độc bỏ rơi.
  const navMenu = computed<NavItem[]>(() => {
    if (settingsData) {
      const raw = settingsData.value?.settings?.nav_menu_navbar || settingsData.value?.settings?.nav_menu
      const parsed = parseNavConfig(raw)
      if (parsed && parsed.length) return parsed
    }
    return DEFAULT_NAV
  })

  const bottomNav = computed<BottomNavItem[]>(() => {
    if (settingsData) {
      const raw = settingsData.value?.settings?.nav_menu_mobile
      const parsed = parseBottomNavConfig(raw)
      if (parsed && parsed.length) return parsed
    }
    return DEFAULT_BOTTOM_NAV
  })

  const NAV_LABEL_TO_KEY: Record<string, string> = {
    'Trang chủ': 'home',
    'Giới thiệu': 'about',
    'Bản tin': 'news',
    'Tin tức': 'news',
    'Tin nổi bật': 'news_featured',
    'Tin hoạt động': 'news_activities',
    'Tin địa phương': 'news_local',
    'Tấm gương tiêu biểu': 'role_models',
    'Tấm gương': 'role_models',
    'Mô hình tái hòa nhập': 'reintegration',
    'Mô hình': 'reintegration',
    'Văn bản': 'documents',
    'Văn bản pháp luật': 'documents',
    'Hỏi đáp pháp luật': 'legal_qa',
    'Hỏi - Đáp': 'legal_qa',
    'Tài liệu Hỏi-Đáp': 'qa_documents',
    'Tài liệu Hỏi – Đáp': 'qa_documents',
    'Thư viện Video': 'video_lib',
    'Thư viện Ảnh': 'photo_lib',
    'Media': 'media',
    'Liên hệ': 'contact',
    'Hỗ trợ 24/7': 'support_247',
    'Đăng ký tư vấn': 'register_help',
    'Trợ lý AI': 'assistant',
    'Trợ lý ảo': 'assistant',
  }

  const navItemLabel = (item: NavItem) => {
    if (currentLang.value !== 'vi') {
      if (item.labelKey) {
        const translated = t(item.labelKey)
        if (translated && translated !== item.labelKey) return translated
      }
      const cleanLabel = item.label?.trim() || ''
      const fallbackKey = NAV_LABEL_TO_KEY[cleanLabel]
      if (fallbackKey) {
        const translated = t(fallbackKey)
        if (translated && translated !== fallbackKey) return translated
      }
    }
    return item.label || (item.labelKey ? t(item.labelKey) : item.url)
  }

  /** `onBottomNavClick` chia state từ `chatWidget` (default.vue) + drawer. */
  const onBottomNavClick = (
    item: BottomNavItem,
    chatWidget: { toggleChatbot?: () => void } | null,
    toggleMobileMenu: () => void,
  ) => {
    if (item.type === 'chatbot') chatWidget?.toggleChatbot?.()
    else if (item.type === 'drawer') toggleMobileMenu()
  }

  // `setNavMenu`/`setBottomNav` giờ là no-op: `navMenu`/`bottomNav` computed
  // đọc trực tiếp từ `settingsData` (xem giải thích ở trên). Giữ signature để
  // `default.vue` `watch(settingsData)` cũ + test grep `setNavMenu`/`setBottomNav`
  // không đỏ — caller không cần biết cơ chế đã đổi.
  const setNavMenu = (_raw: string) => {}
  const setBottomNav = (_raw: string) => {}

  return {
    navMenu,
    bottomNav,
    navItemLabel,
    onBottomNavClick,
    setNavMenu,
    setBottomNav,
  }
}

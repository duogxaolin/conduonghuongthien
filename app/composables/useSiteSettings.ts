import { computed, type Ref } from 'vue'
// Đường dẫn tương đối: test Node nạp thẳng tệp này (layout công khai mount thật —
// tests/public-fetch-rollout-article-print.test.ts); `~/` chỉ Nuxt hiểu.
import { parseLayoutSetting, useLayoutConfig } from './useLayoutConfig'
import type { PublicSettingsPayload } from '../types/public-site-api'

/**
 * Site-wide settings tải qua `/api/public/settings` bằng `useAsyncData` để
 * payload SSR serialize và tái dùng trên hydration client (không phát thêm
 * request, tránh mismatch nav).
 *
 * `siteLogo`/`siteMainLogo` KHÔNG ở đây — nằm trong default.vue vì
 * `tests/main-logo-settings.test.ts` grep `siteMainLogo = computed(` và
 * `siteLogo = computed(` trong source default.vue. Composable này chỉ trả
 * `sitePublicSettings` (raw map) + `setLayoutConfigState` (callback cho
 * `watch(settingsData)`) + setters cho nav config.
 *
 * `useLayoutConfig` sở hữu `containerPx` (chiều rộng container) — default.vue
 * giữ alias `containerPx` + `containerStyleVar` để bind `:style` trên root.
 *
 * **Tại sao `useAsyncData` nằm ở `default.vue` (layout) chứ không trong composable
 * này:** `useAsyncData` trong composable được gọi mà không có `await` sẽ
 * **đăng ký (register)** async work với Nuxt, nhưng `settingsData.value` được
 * đọc **trong** setup chạy đồng bộ — trước khi Nuxt chờ (await) promise đó cho
 * lượt SSR. Kết quả: `navMenu` computed thấy `null` ở lượt SSR đầu → dựng
 * `DEFAULT_NAV`; client hydrate dùng payload DB config → hydration mismatch →
 * class `group` trên `<li>` bị Vue gán sai chỗ → `group-hover` của "Đào tạo
 * nghề"/"Pháp luật" không trigger (xem `useLayoutNav.ts`). Đưa `useAsyncData`
 * lên `default.vue` với `await` ở top-level setup ép Nuxt Suspense chờ resolve
 * xong mới commit render → SSR dựng đúng DB config → không mismatch.
 */
export type PublicSettingsResponse = PublicSettingsPayload

export function useSiteSettings(settingsData: Ref<PublicSettingsResponse | null>) {
  // Site-wide contact details come from Cài đặt chung so an editor's change takes
  // effect on the live site. The literals are only a fallback for the very first
  // render before settings exist.
  const sitePublicSettings = computed(() => settingsData.value?.settings || {})
  const siteHotline = computed(() => sitePublicSettings.value.hotline?.trim() || '0903.480.985')
  const siteEmail = computed(() => sitePublicSettings.value.email?.trim() || 'contact@conduonghuongthien.com.cn')
  const siteAddress = computed(() => sitePublicSettings.value.address?.trim() || 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội')

  const { setConfig: setLayoutConfigState, containerPx } = useLayoutConfig()

  /**
   * Áp dụng settings khi `settingsData` thay đổi: nav menu (navbar + mobile) +
   * layout config (container width / grid bài / MXH). Gọi từ `watch(settingsData)`
   * trong default.vue — tách watcher ra để default.vue kiểm thứ tự (immediate).
   */
  const applySettings = (res: PublicSettingsResponse | null) => {
    if (!res?.settings) return
    // Bố cục site cũng đi qua `/api/public/settings` dưới key `layout_config`
    // (JSON string). useState chia sẻ với composable useLayoutConfig và với
    // admin.vue — fallback default khi key chưa có hoặc JSON sai hình dạng.
    setLayoutConfigState(parseLayoutSetting(res.settings.layout_config))
  }

  return {
    settingsData,
    sitePublicSettings,
    siteHotline,
    siteEmail,
    siteAddress,
    containerPx,
    setLayoutConfigState,
    applySettings,
  }
}

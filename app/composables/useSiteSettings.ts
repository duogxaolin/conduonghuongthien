import { computed } from 'vue'
import { parseLayoutSetting, useLayoutConfig } from '~/composables/useLayoutConfig'

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
 */
type PublicSettingsResponse = { settings?: Record<string, string | null>; faviconUrl?: string | null }

export function useSiteSettings() {
  // Use useAsyncData + $fetch so the payload is serialized from SSR and reused
  // on client hydration without a second network request — eliminates nav data
  // mismatch. (useFetch's route-generic inference overloads TS here — TS2589.)
  const { data: settingsData } = useAsyncData<PublicSettingsResponse | null>(
    'public-settings-nav',
    () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<PublicSettingsResponse>)('/api/public/settings'),
    { default: () => null },
  )

  // Site-wide contact details come from Cài đặt chung so an editor's change takes
  // effect on the live site. The literals are only a fallback for the very first
  // render before settings exist.
  const sitePublicSettings = computed(() => settingsData.value?.settings || {})
  const siteHotline = computed(() => sitePublicSettings.value.hotline?.trim() || '0903.480.985')
  const siteEmail = computed(() => sitePublicSettings.value.email?.trim() || 'contact@conduonghuongthien.com.vn')
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

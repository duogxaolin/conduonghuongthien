/**
 * `settings.layout_config` as an admin form: load it, edit a draft, save the WHOLE row back.
 *
 * Two pages edit the same row — `pages/admin/settings/general.vue` (container width, article
 * grid) and `pages/admin/settings/social-links.vue` (social-button mode) — and `PUT
 * /api/admin/settings/layout` replaces all six fields. A draft that still holds
 * `DEFAULT_LAYOUT_CONFIG` (the load in flight, or the load FAILED) must therefore never reach
 * the PUT: one click overwrote the site's real layout with the defaults (R8, red on a7f312c1 —
 * the menu editor's F-1 of D-FETCH lot F once more). Saving needs the positive `loaded` flag:
 * false until a load has filled the draft, never reset (only "Thử lại" of a FAILED load loads
 * again, and the flag is false then). Each page disables its button on it AND `save` returns
 * without a request when a click reaches it anyway. A failed load lands in `error` (the
 * server's sentence through `errorMessage`); the page renders it with `role="alert"` and a
 * "Thử lại" calling `load` — the state lives here, the branch in the page (D-SPLIT).
 *
 * The page hands in its own `toast` and `setConfig` (the shared `useState` the public layout
 * reads), so a saved layout applies at once and the tests' recorders hear both. Imports are
 * relative: the pages' mount and setup suites load this module natively.
 *
 * Tests: tests/admin-settings-layout-save-gate.test.ts (mount, both pages),
 * tests/admin-fetch-rollout-settings.test.ts (the wire).
 */
import { ref } from 'vue'
import { adminFetch } from './adminFetch'
import { DEFAULT_LAYOUT_CONFIG, type LayoutConfig } from './useLayoutConfig'
import { errorMessage } from '../utils/errorMessage'
import type { LayoutSettingsResponse, LayoutSettingsSaveResponse } from '../types/admin-settings-api'

const LOAD_FALLBACK = 'Không tải được cấu hình bố cục.'

export function useLayoutSettingsForm(options: {
  toast: { success: (message: string) => void; error: (message: string) => void }
  setConfig: (config: LayoutConfig) => void
  /** The page's own success sentence. */
  savedMessage: string
}) {
  /** Ghi vào trạng thái chung chỉ khi lưu thành công — chỉnh tay không đổi trang công khai trước khi Lưu. */
  const draft = ref<LayoutConfig>({ ...DEFAULT_LAYOUT_CONFIG })
  const loading = ref(true)
  const busy = ref(false)
  const loaded = ref(false)
  const error = ref('')

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const res = await adminFetch<LayoutSettingsResponse>('/api/admin/settings/layout')
      if (res?.ok && res.config) {
        draft.value = { ...res.config }
        loaded.value = true
      } else {
        error.value = LOAD_FALLBACK
      }
    } catch (err: unknown) {
      error.value = errorMessage(err, LOAD_FALLBACK)
    } finally {
      loading.value = false
    }
  }

  async function save() {
    if (!loaded.value) return
    busy.value = true
    try {
      const res = await adminFetch<LayoutSettingsSaveResponse>('/api/admin/settings/layout', {
        method: 'PUT', body: { ...draft.value },
      })
      if (res?.ok && res.config) {
        options.setConfig(res.config)
        options.toast.success(options.savedMessage)
      }
    } catch (err: unknown) {
      options.toast.error(errorMessage(err, 'Lưu cấu hình thất bại.'))
    } finally {
      busy.value = false
    }
  }

  return { draft, loading, busy, loaded, error, load, save }
}

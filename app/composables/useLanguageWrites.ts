import { ref, type Ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { LanguageItem, TranslationItem } from '../types/admin-languages'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'

/**
 * The writes of `/admin/languages` (`pages/admin/languages/index.vue`) other than the AI
 * batch (`useLanguageBatchTranslate`): add / turn on-off / make default / delete a language,
 * reorder (▲▼ and the move dialog), save a translation, translate one key with AI, "Nạp mặc
 * định", "Đồng bộ key". Moved out of the page when it was split (wave3 4.2); the page keeps
 * the lists, their loads (handed in) and the load/error/retry contract.
 *
 * `toast`/`confirm` are the page's own, handed in rather than called here, so this file
 * needs no Nuxt auto-import and runs as is under the tests.
 */
export interface LanguageWritesDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  languages: Ref<LanguageItem[]>
  /** The language the translations table shows. */
  selectedLangCode: Ref<string>
  /** `group::key` → Vietnamese text: the source a single key is translated from. */
  viTranslationsMap: Ref<Map<string, string>>
  fetchLanguages: () => Promise<void>
  fetchTranslations: () => Promise<void>
  /** Languages + table + vi source (the page's `loadData`). */
  loadData: () => Promise<void>
  /** Point the table at the language it opens on (after a delete of the one it shows). */
  selectDefaultTranslationLanguage: () => void
}

export function useLanguageWrites({
  toast, confirm, languages, selectedLangCode, viTranslationsMap,
  fetchLanguages, fetchTranslations, loadData, selectDefaultTranslationLanguage,
}: LanguageWritesDeps) {
  // ─── Language cards ──────────────────────────────────────────────────────
  async function addLanguage(data: { code: string; name: string; nativeName: string; displayOrder: number }) {
    try {
      await adminFetch<{ ok: true; id: number }>(`/api/admin/languages`, {
        method: 'POST',
        body: data,
      })
      toast.success('Đã thêm ngôn ngữ mới.')
      await fetchLanguages()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể thêm ngôn ngữ.'))
    }
  }

  async function toggleActive(lang: LanguageItem) {
    try {
      await adminFetch<{ ok: true }>(`/api/admin/languages/${lang.code}`, {
        method: 'PUT',
        body: { isActive: !lang.isActive },
      })
      toast.success(`Đã ${lang.isActive ? 'tắt' : 'bật'} ngôn ngữ.`)
      await fetchLanguages()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể cập nhật.'))
    }
  }

  async function setDefault(lang: LanguageItem) {
    if (lang.isDefault) return
    try {
      await adminFetch<{ ok: true }>(`/api/admin/languages/${lang.code}`, {
        method: 'PUT',
        body: { isDefault: true },
      })
      toast.success(`Đã đặt ${lang.name} làm ngôn ngữ mặc định.`)
      await fetchLanguages()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể đặt mặc định.'))
    }
  }

  async function deleteLanguage(lang: LanguageItem) {
    if (!await confirm({
      message: `Xoá ngôn ngữ "${lang.name}"? Tất cả bản dịch cho ngôn ngữ này cũng sẽ bị xoá.`,
      confirmLabel: 'Xoá ngôn ngữ',
      danger: true,
    })) return
    try {
      await adminFetch<{ ok: true }>(`/api/admin/languages/${lang.code}`, { method: 'DELETE' })
      toast.success('Đã xoá ngôn ngữ.')
      await fetchLanguages()
      if (selectedLangCode.value === lang.code) selectDefaultTranslationLanguage() // the tab must not stay on a deleted language (404)
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể xoá.'))
    }
  }

  // ─── Reorder (LanguagesListTab emits shift-order / open-move) ───────────
  const showMoveModal = ref(false)
  const movingLang = ref<LanguageItem | null>(null)
  const reordering = ref(false)

  function openMoveModal(lang: LanguageItem) {
    movingLang.value = lang
    showMoveModal.value = true
  }

  async function moveLanguageToPosition(targetIndex: number) {
    if (!movingLang.value) return
    const currentIdx = languages.value.findIndex((l) => l.code === movingLang.value!.code)
    if (currentIdx === -1 || currentIdx === targetIndex) {
      showMoveModal.value = false
      return
    }
    const list = [...languages.value]
    const [item] = list.splice(currentIdx, 1)
    if (item) list.splice(targetIndex, 0, item)
    languages.value = list
    showMoveModal.value = false
    await persistOrder(list)
  }

  async function shiftOrder(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= languages.value.length) return
    const list = [...languages.value]
    const item = list[index]!
    list[index] = list[targetIndex]!
    list[targetIndex] = item
    languages.value = list
    await persistOrder(list)
  }

  async function persistOrder(list: LanguageItem[]) {
    reordering.value = true
    const orders = list.map((l, idx) => ({ code: l.code, displayOrder: idx }))
    try {
      await adminFetch<{ ok: true; message: string }>(`/api/admin/languages/reorder`, {
        method: 'POST',
        body: { orders },
      })
      toast.success('Đã cập nhật thứ tự ngôn ngữ thành công!')
      await fetchLanguages()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể lưu thứ tự.'))
    } finally {
      reordering.value = false
    }
  }

  // ─── Translations table (TranslationsTab emits translate-key / save-edit) ──
  const translatingSingleKey = ref<string | null>(null)

  async function translateSingleKey(t: TranslationItem) {
    translatingSingleKey.value = t.key
    const sourceText = viTranslationsMap.value.get(`${t.group}::${t.key}`) || t.key
    const currentLangObj = languages.value.find((l) => l.code === t.langCode) // the ROW's language, not the selection
    try {
      const res = await adminFetch<{ ok: true; group: string; key: string; value: string }>(`/api/admin/languages/ai-translate-key`, {
        method: 'POST',
        body: {
          langCode: t.langCode,
          langName: currentLangObj?.name || t.langCode,
          group: t.group,
          key: t.key,
          sourceText,
        },
      })
      if (res.ok) {
        t.value = res.value
        t.isAiTranslated = true
        toast.success(`Đã dịch khóa "${t.key}" bằng AI!`)
        await fetchLanguages()
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, `Không thể dịch khóa "${t.key}".`))
    } finally {
      translatingSingleKey.value = null
    }
  }

  async function saveEdit(t: TranslationItem, value: string) {
    try {
      await adminFetch<{ ok: true; count: number }>(`/api/admin/languages/${t.langCode}/translations`, {
        method: 'PUT',
        body: { items: [{ group: t.group, key: t.key, value }] },
      })
      toast.success('Đã lưu bản dịch.')
      await fetchTranslations()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể lưu.'))
    }
  }

  // ─── Header: "Nạp mặc định", "Đồng bộ key" ──────────────────────────────
  const seedingDefault = ref(false)
  async function seedDefaultTranslations() {
    if (!await confirm({
      message: 'Hệ thống sẽ nạp lại 6 ngôn ngữ và toàn bộ các bản dịch mặc định (insert-only, không ghi đè dữ liệu bạn đã sửa). Tiếp tục?',
      confirmLabel: 'Nạp bản dịch mặc định',
    })) return
    seedingDefault.value = true
    try {
      const res = await adminFetch<{ ok: true; result: { languagesSeeded: number; translationsSeeded: number }; message: string }>(`/api/admin/languages/seed-default`, { method: 'POST' })
      toast.success(res.message || 'Đã nạp bản dịch mặc định thành công!')
      await Promise.all([fetchLanguages(), fetchTranslations()])
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể nạp bản dịch mặc định.'))
    } finally {
      seedingDefault.value = false
    }
  }

  const syncing = ref(false)
  async function syncAllLanguages() {
    syncing.value = true
    try {
      const res = await adminFetch<{ ok: true; result: { synced: number; totalViKeys: number }; message: string }>(`/api/admin/languages/sync`, { method: 'POST' })
      toast.success(res.message)
      await loadData()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể đồng bộ ngôn ngữ.'))
    } finally {
      syncing.value = false
    }
  }

  return {
    addLanguage, toggleActive, setDefault, deleteLanguage,
    showMoveModal, movingLang, reordering, openMoveModal, moveLanguageToPosition, shiftOrder,
    translatingSingleKey, translateSingleKey, saveEdit,
    seedingDefault, seedDefaultTranslations, syncing, syncAllLanguages,
  }
}
